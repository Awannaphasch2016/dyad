import { verifyToken } from "@clerk/backend";
import type { AdminRoleId } from "@/lib/adminAccess";
import { roleFromMetadata } from "@/lib/adminAccess";
import { roleHasPermission } from "@/auth/permissions";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AccountOwner } from "./owner";
import { privateOwner, sameOwner } from "./owner";
import { sessionTokenFor } from "./session_store";

export interface VerifiedAccount {
  userId: string;
  orgId: string | null;
  roleId: AdminRoleId;
  displayName: string | null;
  member: boolean;
}

export type AccountSession =
  | { mode: "unconfigured" }
  | {
      mode: "signed-in";
      userId: string;
      account: AccountOwner;
      roleId: AdminRoleId;
      displayName: string | null;
    };

export type SessionVerifier = (token: string) => Promise<VerifiedAccount>;

let verifierOverride: SessionVerifier | null = null;

export function setSessionVerifierForTesting(
  verifier: SessionVerifier | null,
): void {
  verifierOverride = verifier;
}

function publishableKeyConfigured(): boolean {
  const key = process.env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  return key.startsWith("pk_test_") || key.startsWith("pk_live_");
}

export function clerkEnforced(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY?.trim() && publishableKeyConfigured(),
  );
}

export function sharingEnabled(): boolean {
  return clerkEnforced() && Boolean(process.env.WEWEBPLUS_DATABASE_URL?.trim());
}

export function roleFromMembership(
  metadata: unknown,
  clerkRole: unknown,
): AdminRoleId {
  if (
    metadata &&
    typeof metadata === "object" &&
    "role" in metadata &&
    (metadata as { role?: unknown }).role != null
  ) {
    return roleFromMetadata(metadata);
  }
  if (clerkRole === "org:admin" || clerkRole === "admin") return "admin";
  return "reviewer";
}

export async function defaultVerifySessionToken(
  token: string,
): Promise<VerifiedAccount> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
  }
  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(token, { secretKey });
  } catch {
    throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
  }
  const userId = payload.sub;
  if (!userId) {
    throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
  }
  const orgClaim = payload.o;
  const orgId =
    orgClaim && typeof orgClaim === "object" && "id" in orgClaim
      ? String((orgClaim as { id?: unknown }).id ?? "")
      : "";
  if (!orgId) {
    return {
      userId,
      orgId: null,
      roleId: "admin",
      displayName: null,
      member: true,
    };
  }
  const membership = await fetchOrgMembership(orgId, userId);
  if (!membership) {
    return {
      userId,
      orgId,
      roleId: "reviewer",
      displayName: null,
      member: false,
    };
  }
  return {
    userId,
    orgId,
    roleId: roleFromMembership(membership.metadata, membership.clerkRole),
    displayName: membership.displayName,
    member: true,
  };
}

async function fetchOrgMembership(
  orgId: string,
  userId: string,
): Promise<{
  metadata: unknown;
  clerkRole: unknown;
  displayName: string | null;
} | null> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;
  const response = await fetch(
    `https://api.clerk.com/v1/organizations/${orgId}/memberships?limit=100`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
        "User-Agent": "wewebplus",
      },
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: Array<Record<string, unknown>>;
  };
  const match = (body.data ?? []).find((row) => {
    const user = row.public_user_data;
    return (
      user &&
      typeof user === "object" &&
      (user as { user_id?: unknown }).user_id === userId
    );
  });
  if (!match) return null;
  const user = match.public_user_data as {
    first_name?: unknown;
    last_name?: unknown;
    identifier?: unknown;
  };
  const name = [user.first_name, user.last_name]
    .filter((part) => typeof part === "string" && part)
    .join(" ");
  return {
    metadata: match.public_metadata,
    clerkRole: match.role,
    displayName:
      name || (typeof user.identifier === "string" ? user.identifier : null),
  };
}

export async function resolveAccountSession(event: {
  sender: { id: number };
}): Promise<AccountSession> {
  if (!clerkEnforced()) return { mode: "unconfigured" };
  const token = sessionTokenFor(event.sender.id);
  if (!token) {
    throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
  }
  const verify = verifierOverride ?? defaultVerifySessionToken;
  const verified = await verify(token);
  if (verified.orgId && !verified.member) {
    throw new DyadError(
      "You are no longer a member of this organization.",
      DyadErrorKind.Auth,
    );
  }
  const account = verified.orgId
    ? { type: "org" as const, id: verified.orgId }
    : privateOwner(verified.userId);
  return {
    mode: "signed-in",
    userId: verified.userId,
    account,
    roleId: verified.orgId ? verified.roleId : "admin",
    displayName: verified.displayName,
  };
}

export async function sharingScope(event: {
  sender: { id: number };
}): Promise<{
  session: Extract<AccountSession, { mode: "signed-in" }>;
} | null> {
  if (!sharingEnabled()) return null;
  const session = await resolveAccountSession(event);
  if (session.mode !== "signed-in") return null;
  return { session };
}

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "not-found" }
  | { kind: "forbidden"; message: string }
  | { kind: "precondition"; message: string };

export function decideAccess(input: {
  session: AccountSession;
  permission: string;
  owner: AccountOwner;
  /** Invite and role changes exist only on an organization. */
  organizationOnly?: boolean;
}): AccessDecision {
  if (input.session.mode === "unconfigured") return { kind: "allow" };
  if (!sameOwner(input.session.account, input.owner)) {
    return { kind: "not-found" };
  }
  if (input.organizationOnly && input.owner.type !== "org") {
    return {
      kind: "precondition",
      message: "This account has no members.",
    };
  }
  const allowed =
    input.session.roleId === "admin" ||
    roleHasPermission(input.session.roleId, input.permission);
  if (!allowed) {
    return {
      kind: "forbidden",
      message: "Your role can't do that.",
    };
  }
  return { kind: "allow" };
}

/** An app can move into the signed-in user's private account, or into an organization they admin. */
export function destinationAllowed(input: {
  session: AccountSession;
  destination: AccountOwner;
  destinationRole: AdminRoleId | null;
}): boolean {
  if (input.session.mode === "unconfigured") return true;
  if (input.session.mode !== "signed-in") return false;
  if (input.destination.type === "user") {
    return input.destination.id === input.session.userId;
  }
  const role = sameOwner(input.session.account, input.destination)
    ? input.session.roleId
    : input.destinationRole;
  return role === "admin";
}

export async function organizationRoleForUser(
  userId: string,
  orgId: string,
): Promise<AdminRoleId | null> {
  const membership = await fetchOrgMembership(orgId, userId);
  if (!membership) return null;
  return roleFromMembership(membership.metadata, membership.clerkRole);
}

export function assertDecision(decision: AccessDecision): void {
  if (decision.kind === "allow") return;
  if (decision.kind === "not-found") {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  if (decision.kind === "precondition") {
    throw new DyadError(decision.message, DyadErrorKind.Precondition);
  }
  throw new DyadError(decision.message, DyadErrorKind.Auth);
}

export async function assertCan(
  event: { sender: { id: number } },
  permission: string,
  owner: AccountOwner,
  options?: { organizationOnly?: boolean },
): Promise<AccountSession> {
  const session = await resolveAccountSession(event);
  assertDecision(
    decideAccess({
      session,
      permission,
      owner,
      organizationOnly: options?.organizationOnly,
    }),
  );
  return session;
}
