import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  clerkAccountPortalUrls,
  clerkDirectoryFromApi,
  copyAdminRoles,
} from "@/lib/adminAccess";
import { clerkContracts } from "../types/clerk";
import { createTypedHandler } from "./base";

const logger = log.scope("clerk_handlers");

export function registerClerkHandlers() {
  createTypedHandler(clerkContracts.getAccess, async () => {
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
    const secretKey = process.env.CLERK_SECRET_KEY;
    const urls = clerkAccountPortalUrls(publishableKey);
    if (!secretKey) {
      return {
        configured: false,
        ...urls,
        members: [],
        roles: copyAdminRoles(),
      };
    }
    const [users, invitations] = await Promise.all([
      clerkRequest("/v1/users?limit=100"),
      clerkRequest("/v1/invitations?limit=100&status=pending"),
    ]);
    return {
      configured: true,
      ...urls,
      members: clerkDirectoryFromApi(users, invitations),
      roles: copyAdminRoles(),
    };
  });

  createTypedHandler(clerkContracts.inviteMember, async (_, params) => {
    const email = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DyadError(
        "Enter an email address for this member.",
        DyadErrorKind.Validation,
      );
    }
    const created = await clerkRequest("/v1/invitations", {
      method: "POST",
      body: JSON.stringify({
        email_address: email,
        public_metadata: { role: params.roleId },
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
      roleId: params.roleId,
      status: "invited" as const,
    };
  });

  createTypedHandler(clerkContracts.setMemberRole, async (_, params) => {
    if (!/^user_[A-Za-z0-9]+$/.test(params.userId)) {
      throw new DyadError(
        "Choose an active member to change their role.",
        DyadErrorKind.Validation,
      );
    }
    const current = await clerkRequest(`/v1/users/${params.userId}`);
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
    metadata.role = params.roleId;
    const updated = await clerkRequest(`/v1/users/${params.userId}`, {
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
  });
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
