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
