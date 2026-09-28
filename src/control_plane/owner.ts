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

/** An app from before accounts. A row that already has an owner stays there. */
export function isLegacyUnownedApp(app: {
  remoteId: string | null;
  ownerType: OwnerType | null;
  ownerId: string | null;
}): boolean {
  return app.remoteId == null && app.ownerType == null && app.ownerId == null;
}
