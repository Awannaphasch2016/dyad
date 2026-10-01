import { randomUUID } from "node:crypto";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  clerkAccountPortalUrls,
  clerkDirectoryFromApi,
  copyAdminRoles,
  roleFromMetadata,
  type AdminRoleId,
} from "@/lib/adminAccess";
import {
  assertDecision,
  decideAccess,
  resolveAccountSession,
} from "@/control_plane/access";
import { getControlPlaneDb } from "@/control_plane/db";
import { recordAudit } from "@/control_plane/repository";
import {
  rememberSessionToken,
  WEB_BRIDGE_SENDER_ID,
} from "@/control_plane/session_store";
import { clerkContracts } from "../types/clerk";
import { createTypedHandler } from "./base";

const logger = log.scope("clerk_handlers");

/**
 * Only a Clerk publishable key may cross into the renderer.
 * A secret key pasted into this env var stays in main and the app stays ungated.
 */
export function clerkPublishableKeyFromEnv(
  value: string | undefined,
): string | null {
  const key = value?.trim() ?? "";
  if (!key.startsWith("pk_test_") && !key.startsWith("pk_live_")) return null;
  return key;
}

export function registerClerkHandlers() {
  createTypedHandler(clerkContracts.getPublishableKey, async () => {
    return {
      publishableKey: clerkPublishableKeyFromEnv(
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    };
  });

  createTypedHandler(clerkContracts.getAccess, async (event) => {
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
    const secretKey = process.env.CLERK_SECRET_KEY;
    const urls = clerkAccountPortalUrls(publishableKey);
    if (!secretKey) {
      return {
        configured: false,
        accountKind: "unconfigured" as const,
        ...urls,
        members: [],
        roles: copyAdminRoles(),
      };
    }
    const session = await resolveAccountSession(event);
    if (session.mode !== "signed-in" || session.account.type !== "org") {
      return {
        configured: true,
        accountKind: "private" as const,
        ...urls,
        members: [],
        roles: copyAdminRoles(),
      };
    }
    const orgId = session.account.id;
    const [memberships, invitations] = await Promise.all([
      clerkRequest(`/v1/organizations/${orgId}/memberships?limit=100`),
      clerkRequest(
        `/v1/organizations/${orgId}/invitations?limit=100&status=pending`,
      ),
    ]);
    return {
      configured: true,
      accountKind: "organization" as const,
      ...urls,
      members: orgDirectoryFromApi(memberships, invitations),
      roles: copyAdminRoles(),
    };
  });

  createTypedHandler(clerkContracts.inviteMember, async (event, params) => {
    const email = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DyadError(
        "Enter an email address for this member.",
        DyadErrorKind.Validation,
      );
    }
    const session = await resolveAccountSession(event);
    if (session.mode !== "signed-in" || session.account.type !== "org") {
      if (session.mode === "unconfigured") {
        return inviteInstanceMember(email, params.roleId);
      }
      throw new DyadError(
        "This account has no members.",
        DyadErrorKind.Precondition,
      );
    }
    assertDecision(
      decideAccess({
        session,
        permission: "manage-members",
        owner: session.account,
        organizationOnly: true,
      }),
    );
    const created = await clerkRequest(
      `/v1/organizations/${session.account.id}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({
          email_address: email,
          role: "org:member",
          public_metadata: { role: params.roleId },
          inviter_user_id: session.userId,
        }),
      },
    );
    await writeMemberAudit(session, "invite", email);
    const record =
      created && typeof created === "object"
        ? (created as Record<string, unknown>)
        : {};
    const id = typeof record.id === "string" ? record.id : "";
    return {
      id,
      name: email,
      email,
      roleId: params.roleId,
      status: "invited" as const,
    };
  });

  createTypedHandler(clerkContracts.setMemberRole, async (event, params) => {
    if (!/^user_[A-Za-z0-9]+$/.test(params.userId)) {
      throw new DyadError(
        "Choose an active member to change their role.",
        DyadErrorKind.Validation,
      );
    }
    const session = await resolveAccountSession(event);
    if (session.mode === "unconfigured") {
      return setInstanceMemberRole(params.userId, params.roleId);
    }
    if (session.account.type !== "org") {
      throw new DyadError(
        "This account has no members.",
        DyadErrorKind.Precondition,
      );
    }
    assertDecision(
      decideAccess({
        session,
        permission: "manage-members",
        owner: session.account,
        organizationOnly: true,
      }),
    );
    const updated = await clerkRequest(
      `/v1/organizations/${session.account.id}/memberships/${params.userId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ public_metadata: { role: params.roleId } }),
      },
    );
    await writeMemberAudit(session, "set-role", params.userId);
    const [member] = orgDirectoryFromApi({ data: [updated] }, []);
    if (!member) {
      throw new DyadError(
        "Clerk updated the role, but the member could not be read back.",
        DyadErrorKind.External,
      );
    }
    return member;
  });

  createTypedHandler(clerkContracts.removeMember, async (event, params) => {
    const session = await resolveAccountSession(event);
    if (session.mode !== "signed-in" || session.account.type !== "org") {
      throw new DyadError(
        "This account has no members.",
        DyadErrorKind.Precondition,
      );
    }
    assertDecision(
      decideAccess({
        session,
        permission: "manage-members",
        owner: session.account,
        organizationOnly: true,
      }),
    );
    await clerkRequest(
      `/v1/organizations/${session.account.id}/memberships/${params.userId}`,
      { method: "DELETE" },
    );
    await writeMemberAudit(session, "remove-member", params.userId);
  });

  createTypedHandler(
    clerkContracts.stampOrganizationAdmin,
    async (event, params) => {
      const session = await resolveAccountSession(event);
      if (session.mode !== "signed-in") {
        throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
      }
      if (!/^org_[A-Za-z0-9]+$/.test(params.organizationId)) {
        throw new DyadError(
          "Choose an organization to continue.",
          DyadErrorKind.Validation,
        );
      }
      const membershipPath = `/v1/organizations/${params.organizationId}/memberships/${session.userId}`;
      // Clerk has no GET for one membership. Listing is the read that exists.
      const listed = await clerkRequest(
        `/v1/organizations/${params.organizationId}/memberships?user_id=${encodeURIComponent(session.userId)}`,
      );
      const role = membershipRoleForUser(listed, session.userId);
      // Clerk makes the creator org:admin. Invited members stay org:member
      // until an admin changes them, so they cannot stamp themselves.
      if (role !== "org:admin" && role !== "admin") {
        throw new DyadError(
          "Only the person who created the organization is its admin.",
          DyadErrorKind.Auth,
        );
      }
      await clerkRequest(membershipPath, {
        method: "PATCH",
        body: JSON.stringify({
          role: "org:admin",
        }),
      });
    },
  );

  createTypedHandler(clerkContracts.setSessionToken, async (event, params) => {
    rememberSessionToken(
      params.bridge ? WEB_BRIDGE_SENDER_ID : event.sender.id,
      params.token,
    );
  });
}

async function inviteInstanceMember(email: string, roleId: AdminRoleId) {
  const created = await clerkRequest("/v1/invitations", {
    method: "POST",
    body: JSON.stringify({
      email_address: email,
      public_metadata: { role: roleId },
      notify: true,
    }),
  });
  const record =
    created && typeof created === "object"
      ? (created as Record<string, unknown>)
      : {};
  const id = typeof record.id === "string" ? record.id : "";
  return {
    id,
    name: email,
    email,
    roleId,
    status: "invited" as const,
  };
}

async function setInstanceMemberRole(userId: string, roleId: AdminRoleId) {
  const current = await clerkRequest(`/v1/users/${userId}`);
  const metadata =
    current &&
    typeof current === "object" &&
    (current as { public_metadata?: unknown }).public_metadata &&
    typeof (current as { public_metadata?: unknown }).public_metadata ===
      "object"
      ? {
          ...(current as { public_metadata: Record<string, unknown> })
            .public_metadata,
        }
      : {};
  metadata.role = roleId;
  const updated = await clerkRequest(`/v1/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ public_metadata: metadata }),
  });
  const [member] = clerkDirectoryFromApi([updated], []);
  if (!member) {
    throw new DyadError(
      "Clerk updated the role, but the member could not be read back.",
      DyadErrorKind.External,
    );
  }
  return member;
}

async function writeMemberAudit(
  session: {
    userId: string;
    account: { type: "user" | "org"; id: string };
  },
  action: string,
  subject: string,
) {
  const plane = await getControlPlaneDb();
  if (!plane) return;
  await recordAudit(plane, {
    id: randomUUID(),
    owner: session.account,
    actorId: session.userId,
    action,
    subject,
  });
}

function membershipRoleForUser(body: unknown, userId: string): string | null {
  const rows = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as {
      role?: unknown;
      public_user_data?: { user_id?: unknown };
    };
    if (record.public_user_data?.user_id !== userId) continue;
    return typeof record.role === "string" ? record.role : null;
  }
  return null;
}

function orgDirectoryFromApi(memberships: unknown, invitations: unknown) {
  const rows = Array.isArray(memberships)
    ? memberships
    : memberships &&
        typeof memberships === "object" &&
        Array.isArray((memberships as { data?: unknown }).data)
      ? ((memberships as { data: unknown[] }).data ?? [])
      : [];
  const invites = Array.isArray(invitations)
    ? invitations
    : invitations &&
        typeof invitations === "object" &&
        Array.isArray((invitations as { data?: unknown }).data)
      ? ((invitations as { data: unknown[] }).data ?? [])
      : [];
  const active = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as {
      public_user_data?: {
        user_id?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        identifier?: unknown;
      };
      public_metadata?: unknown;
    };
    const user = record.public_user_data;
    const id = typeof user?.user_id === "string" ? user.user_id : "";
    if (!id) return [];
    const email = typeof user?.identifier === "string" ? user.identifier : id;
    const name =
      [user?.first_name, user?.last_name]
        .filter((part) => typeof part === "string" && part)
        .join(" ") || email;
    return [
      {
        id,
        name,
        email,
        roleId: roleFromMetadata(record.public_metadata),
        status: "active" as const,
      },
    ];
  });
  const pending = invites.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as {
      id?: unknown;
      email_address?: unknown;
      public_metadata?: unknown;
    };
    const email =
      typeof record.email_address === "string" ? record.email_address : "";
    if (!email) return [];
    return [
      {
        id: typeof record.id === "string" ? record.id : email,
        name: email,
        email,
        roleId: roleFromMetadata(record.public_metadata),
        status: "invited" as const,
      },
    ];
  });
  return [...active, ...pending];
}

async function clerkRequest(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new DyadError(
      "Clerk is not configured. Add the Clerk keys from Doppler to the environment.",
      DyadErrorKind.Precondition,
    );
  }
  let response: Response;
  try {
    response = await fetch(`https://api.clerk.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "wewebplus",
        ...init?.headers,
      },
    });
  } catch (error) {
    logger.warn("Clerk request failed", path, error);
    throw new DyadError(
      "Couldn't reach Clerk. Check the network and try again.",
      DyadErrorKind.External,
    );
  }
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new DyadError(
      clerkErrorMessage(body, response.status),
      response.status === 401 || response.status === 403
        ? DyadErrorKind.Auth
        : response.status === 422
          ? DyadErrorKind.Validation
          : DyadErrorKind.External,
    );
  }
  return body;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clerkErrorMessage(body: unknown, status: number): string {
  const errors =
    body && typeof body === "object"
      ? (body as { errors?: unknown }).errors
      : null;
  const first = Array.isArray(errors) ? errors[0] : null;
  if (first && typeof first === "object") {
    const record = first as { long_message?: unknown; message?: unknown };
    if (typeof record.long_message === "string" && record.long_message) {
      return record.long_message;
    }
    if (typeof record.message === "string" && record.message) {
      return record.message;
    }
  }
  return `Clerk returned ${status}.`;
}
