export const LAST_ACCOUNT_METADATA_KEY = "wewebplusLastAccount";

export type AccountRestore =
  | { kind: "keep" }
  | { kind: "private" }
  | { kind: "organization"; id: string };

export function readLastAccount(metadata: unknown): "private" | string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[
    LAST_ACCOUNT_METADATA_KEY
  ];
  if (value === "private") return "private";
  if (typeof value === "string" && value.startsWith("org_")) return value;
  return null;
}

export function withLastAccount(
  metadata: Record<string, unknown> | undefined,
  organizationId: string | null,
): Record<string, unknown> {
  return {
    ...metadata,
    [LAST_ACCOUNT_METADATA_KEY]: organizationId ?? "private",
  };
}

/**
 * The Clerk session on this device may still be private after sign-in.
 * The saved choice restores the organization the person last used on any device.
 * Signing out drops the session; the saved choice is what the next sign-in reads.
 */
export function restoreLastAccount(input: {
  saved: "private" | string | null;
  activeOrganizationId: string | null;
  membershipOrganizationIds: readonly string[];
}): AccountRestore {
  if (input.saved === null) return { kind: "keep" };
  if (input.saved === "private") {
    return input.activeOrganizationId ? { kind: "private" } : { kind: "keep" };
  }
  if (!input.membershipOrganizationIds.includes(input.saved)) {
    return { kind: "keep" };
  }
  if (input.activeOrganizationId === input.saved) return { kind: "keep" };
  return { kind: "organization", id: input.saved };
}
