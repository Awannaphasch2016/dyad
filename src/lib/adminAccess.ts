export const ADMIN_ROLE_IDS = ["admin", "member"] as const;

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
  roleId: AdminRoleId;
  status: "active" | "invited";
}

export const ADMIN_ROLES: readonly AdminRole[] = [
  {
    id: "admin",
    name: "Admin",
    permissions: [
      { id: "approve-discovery", label: "Approve Discovery" },
      { id: "approve-implementation", label: "Approve Implementation" },
      { id: "approve-delivery", label: "Approve Delivery" },
      { id: "manage-members", label: "Manage members" },
    ],
  },
  {
    id: "member",
    name: "Member",
    permissions: [
      { id: "view-page", label: "View the page" },
      { id: "comment", label: "Comment on a phase" },
    ],
  },
];

export function isAdminRoleId(value: unknown): value is AdminRoleId {
  return value === "admin" || value === "member";
}

export function roleFromMetadata(metadata: unknown): AdminRoleId {
  if (!metadata || typeof metadata !== "object") return "member";
  const role = (metadata as { role?: unknown }).role;
  return isAdminRoleId(role) ? role : "member";
}

export function copyAdminRoles(): AdminRole[] {
  return ADMIN_ROLES.map((role) => ({
    ...role,
    permissions: role.permissions.map((permission) => ({ ...permission })),
  }));
}

export function adminRoleById(roleId: AdminRoleId): AdminRole {
  const role = ADMIN_ROLES.find((item) => item.id === roleId);
  if (!role) return ADMIN_ROLES[1];
  return role;
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
    const decoded = Buffer.from(padded, "base64").toString("utf8");
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
