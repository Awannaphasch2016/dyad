export const ADMIN_ROLE_IDS = ["project-manager", "developer"] as const;

export type AdminRoleId = (typeof ADMIN_ROLE_IDS)[number];

export interface AdminPermission {
  id: string;
  label: string;
}

export interface AdminRole {
  id: AdminRoleId;
  name: string;
  permissions: AdminPermission[];
}

export interface AdminMember {
  id: string;
  name: string;
  email: string;
  roleId: AdminRoleId | null;
  status: "active" | "invited";
}

export const ADMIN_ROLES: readonly AdminRole[] = [
  {
    id: "project-manager",
    name: "Project Manager",
    permissions: [
      { id: "approve-discovery", label: "Approve discovery" },
      { id: "approve-implementation", label: "Approve implementation" },
      { id: "approve-delivery", label: "Approve delivery" },
      { id: "view-page", label: "View the page" },
      { id: "comment", label: "Comment on a phase" },
    ],
  },
  {
    id: "developer",
    name: "Developer",
    permissions: [
      { id: "view-page", label: "View the page" },
      { id: "comment", label: "Comment on a phase" },
      { id: "work-implementation", label: "Work in implementation" },
    ],
  },
];

export function isAdminRoleId(value: unknown): value is AdminRoleId {
  return value === "project-manager" || value === "developer";
}

/**
 * Only project-manager and developer can answer a gate. An unknown value,
 * including the old admin/reviewer/dev names, is not a gate role.
 */
export function roleFromMetadata(metadata: unknown): AdminRoleId | null {
  if (!metadata || typeof metadata !== "object") return null;
  const role = (metadata as { role?: unknown }).role;
  return isAdminRoleId(role) ? role : null;
}

/**
 * Gate role comes from membership metadata. Clerk org:admin stays an
 * invitation flag and does not become a role that can answer a gate.
 */
export function roleFromClerkMembership(
  metadata: unknown,
  _clerkRole: unknown,
): AdminRoleId | null {
  return roleFromMetadata(metadata);
}

export function clerkCanInvite(clerkRole: unknown): boolean {
  return clerkRole === "org:admin" || clerkRole === "admin";
}

export function copyAdminRoles(): AdminRole[] {
  return ADMIN_ROLES.map((role) => ({
    ...role,
    permissions: role.permissions.map((permission) => ({ ...permission })),
  }));
}

export function adminRoleById(roleId: AdminRoleId): AdminRole {
  const role = ADMIN_ROLES.find((item) => item.id === roleId);
  if (!role) {
    return {
      id: roleId,
      name: roleId,
      permissions: [],
    };
  }
  return role;
}

function decodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Clerk publishable keys encode the Account Portal host after the prefix. */
export function clerkAccountPortalUrls(publishableKey: string | undefined): {
  signInUrl: string | null;
  signUpUrl: string | null;
} {
  const host = clerkFrontendHost(publishableKey);
  if (!host) return { signInUrl: null, signUpUrl: null };
  return {
    signInUrl: `https://${host}/sign-in`,
    signUpUrl: `https://${host}/sign-up`,
  };
}

export function clerkFrontendHost(
  publishableKey: string | undefined,
): string | null {
  if (!publishableKey) return null;
  const prefix = publishableKey.startsWith("pk_test_")
    ? "pk_test_"
    : publishableKey.startsWith("pk_live_")
      ? "pk_live_"
      : null;
  if (!prefix) return null;
  try {
    const encoded = publishableKey.slice(prefix.length);
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const decoded = decodeBase64(padded);
    const host = decoded.replace(/\$$/, "").trim();
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

export function clerkDirectoryFromApi(
  users: unknown,
  invitations: unknown,
): AdminMember[] {
  const active = asRecords(users).flatMap((user) => {
    const id = stringField(user, "id");
    if (!id.startsWith("user_")) return [];
    const email = primaryEmail(user);
    const name = displayName(user, email);
    return [
      {
        id,
        name,
        email,
        roleId: roleFromMetadata(user.public_metadata),
        status: "active" as const,
      },
    ];
  });
  const invited = asRecords(invitations).flatMap((invitation) => {
    const id = stringField(invitation, "id");
    const email = stringField(invitation, "email_address");
    const status = stringField(invitation, "status");
    if (!id.startsWith("inv_") || !email || status === "accepted") return [];
    if (status && status !== "pending") return [];
    return [
      {
        id,
        name: email,
        email,
        roleId: roleFromMetadata(invitation.public_metadata),
        status: "invited" as const,
      },
    ];
  });
  return [...active, ...invited];
}

function asRecords(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function primaryEmail(user: Record<string, unknown>): string {
  const emails = Array.isArray(user.email_addresses)
    ? user.email_addresses
    : [];
  const primaryId = stringField(user, "primary_email_address_id");
  for (const email of emails) {
    if (!email || typeof email !== "object") continue;
    const record = email as Record<string, unknown>;
    const address = stringField(record, "email_address");
    if (address && stringField(record, "id") === primaryId) return address;
  }
  for (const email of emails) {
    if (!email || typeof email !== "object") continue;
    const address = stringField(
      email as Record<string, unknown>,
      "email_address",
    );
    if (address) return address;
  }
  return stringField(user, "username") || stringField(user, "id");
}

function displayName(user: Record<string, unknown>, email: string): string {
  const name = [stringField(user, "first_name"), stringField(user, "last_name")]
    .filter(Boolean)
    .join(" ");
  return name || email;
}
