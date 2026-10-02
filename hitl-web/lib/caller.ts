import { auth, currentUser } from "@clerk/nextjs/server";
import { getSql } from "./db";
import type { HitlCaller } from "./hitl";
import { chooseMembership } from "./membership";
import { readMemberships } from "./store";

export type CallerResult =
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "not-found" }
  | { kind: "caller"; caller: HitlCaller };

export async function resolveCaller(): Promise<CallerResult> {
  const session = await auth();
  if (!session.userId) return { kind: "signed-out" };
  const sql = getSql();
  if (!sql) return { kind: "unavailable" };
  const memberships = await readMemberships(sql, session.userId);
  const membership = chooseMembership(memberships, session.orgId ?? null);
  if (!membership) return { kind: "not-found" };
  const user = await currentUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  return {
    kind: "caller",
    caller: {
      orgId: membership.orgId,
      userId: session.userId,
      roleId: membership.roleId,
      displayName: name || user?.username || session.userId,
    },
  };
}
