import type { AccountOwner } from "./owner";
import { sameOwner } from "./owner";

export interface OwnedRow {
  ownerType: "user" | "org" | null;
  ownerId: string | null;
}

/** Null scope keeps every row (Clerk or the control plane is not configured). */
export function selectVisibleApps<T extends OwnedRow>(
  apps: readonly T[],
  scope: AccountOwner | null,
): T[] {
  if (!scope) return [...apps];
  return apps.filter(
    (app) =>
      app.ownerType != null &&
      app.ownerId != null &&
      sameOwner({ type: app.ownerType, id: app.ownerId }, scope),
  );
}

export function appVisibleToAccount(
  app: OwnedRow,
  scope: AccountOwner | null,
): boolean {
  if (!scope) return true;
  return selectVisibleApps([app], scope).length === 1;
}

/**
 * Sharing off: any other row blocks the name.
 * Sharing on: the active account and not-yet-claimed rows on this device block it.
 * Another account's cached name does not.
 */
export function displayNameTaken<T extends OwnedRow & { id: number }>(
  rows: readonly T[],
  scope: AccountOwner | null,
  excludeAppId?: number,
): boolean {
  return rows.some((row) => {
    if (row.id === excludeAppId) return false;
    if (!scope) return true;
    if (!row.ownerType || !row.ownerId) return true;
    return sameOwner({ type: row.ownerType, id: row.ownerId }, scope);
  });
}
