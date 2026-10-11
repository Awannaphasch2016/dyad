export type OwnerType = "user" | "org";

export interface AccountOwner {
  type: OwnerType;
  id: string;
}

export function privateOwner(userId: string): AccountOwner {
  return { type: "user", id: userId };
}

export function sameOwner(left: AccountOwner, right: AccountOwner): boolean {
  return left.type === right.type && left.id === right.id;
}

export function ownerKey(owner: AccountOwner): string {
  return `${owner.type}:${owner.id}`;
}

/**
 * The account on a newly created app. Clerk off leaves the row unowned so
 * existing local apps stay as they are. Sharing to Neon is a separate step.
 */
export function ownerForNewApp(session: {
  mode: "unconfigured" | "signed-in";
  account?: AccountOwner;
}): AccountOwner | null {
  if (session.mode !== "signed-in" || !session.account) return null;
  return session.account;
}

/** An app from before accounts. A row that already has an owner stays there. */
export function isLegacyUnownedApp(app: {
  remoteId: string | null;
  ownerType: OwnerType | null;
  ownerId: string | null;
}): boolean {
  return app.remoteId == null && app.ownerType == null && app.ownerId == null;
}
