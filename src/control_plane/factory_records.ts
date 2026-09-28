import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  answerLocks,
  apps,
  chats,
  factoryPhaseApprovals,
  factoryPhaseComments,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AdminRoleId } from "@/lib/adminAccess";
import type { FactoryPhase } from "@/lib/factoryPhase";
import { assertCan, type AccountSession } from "./access";
import { getControlPlaneDb } from "./db";
import {
  deleteAnswerLock,
  insertControlComment,
  listControlApprovals,
  listControlComments,
  recordAudit,
  upsertAnswerLock,
  upsertControlApproval,
} from "./repository";

const LOCK_MS = 2 * 60 * 1000;

function approvalPhase(phase: string): FactoryPhase | null {
  if (
    phase === "discovery" ||
    phase === "implementation" ||
    phase === "delivery"
  ) {
    return phase;
  }
  return null;
}

export interface PhaseApprovalRecord {
  phase: string;
  memberId: string;
  memberName: string;
  roleId: string;
  approvedAt: Date;
}

function memberLabel(session: AccountSession): {
  memberId: string;
  memberName: string;
  roleId: AdminRoleId | "";
} {
  if (session.mode !== "signed-in") {
    return { memberId: "", memberName: "", roleId: "" };
  }
  return {
    memberId: session.userId,
    memberName: session.displayName || session.userId,
    roleId: session.roleId,
  };
}

async function requireOwnedApp(
  event: { sender: { id: number } },
  appId: number,
  permission: string,
) {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  if (!app.ownerType || !app.ownerId) {
    const { resolveAccountSession } = await import("./access");
    const session = await resolveAccountSession(event);
    return { app, session };
  }
  const session = await assertCan(event, permission, {
    type: app.ownerType,
    id: app.ownerId,
  });
  return { app, session };
}

export async function listPhaseApprovals(
  event: { sender: { id: number } },
  appId: number,
): Promise<PhaseApprovalRecord[]> {
  const { app } = await requireOwnedApp(event, appId, "view-page");
  const plane = await getControlPlaneDb();
  if (plane && app.remoteId) {
    const remote = await listControlApprovals(plane, app.remoteId);
    for (const row of remote) {
      const phase = approvalPhase(row.phase);
      if (!phase) continue;
      const existing = db
        .select()
        .from(factoryPhaseApprovals)
        .where(
          and(
            eq(factoryPhaseApprovals.appId, appId),
            eq(factoryPhaseApprovals.phase, phase),
          ),
        )
        .get();
      if (existing) continue;
      db.insert(factoryPhaseApprovals)
        .values({
          appId,
          phase,
          memberId: row.memberId,
          memberName: row.memberName,
          roleId: row.roleId,
          remoteId: row.id,
          approvedAt: row.approvedAt,
        })
        .run();
    }
  }
  return db
    .select()
    .from(factoryPhaseApprovals)
    .where(eq(factoryPhaseApprovals.appId, appId))
    .all()
    .map((row) => ({
      phase: row.phase,
      memberId: row.memberId,
      memberName: row.memberName,
      roleId: row.roleId,
      approvedAt: row.approvedAt,
    }));
}

export async function approvePhase(
  event: { sender: { id: number } },
  appId: number,
  phase: string,
): Promise<void> {
  const permission =
    phase === "discovery"
      ? "approve-discovery"
      : phase === "implementation"
        ? "approve-implementation"
        : "approve-delivery";
  const { app, session } = await requireOwnedApp(event, appId, permission);
  const factoryPhase = approvalPhase(phase);
  if (!factoryPhase) {
    throw new DyadError("Unknown factory phase.", DyadErrorKind.Validation);
  }
  const existing = db
    .select()
    .from(factoryPhaseApprovals)
    .where(
      and(
        eq(factoryPhaseApprovals.appId, appId),
        eq(factoryPhaseApprovals.phase, factoryPhase),
      ),
    )
    .get();
  if (existing) return;
  const member = memberLabel(session);
  const remoteId = randomUUID();
  db.insert(factoryPhaseApprovals)
    .values({
      appId,
      phase: factoryPhase,
      memberId: member.memberId,
      memberName: member.memberName,
      roleId: member.roleId,
      remoteId,
    })
    .run();
  const plane = await getControlPlaneDb();
  if (plane && app.remoteId && app.ownerType && app.ownerId) {
    await upsertControlApproval(plane, {
      id: remoteId,
      appId: app.remoteId,
      phase,
      memberId: member.memberId,
      memberName: member.memberName,
      roleId: member.roleId,
    });
    if (session.mode === "signed-in") {
      await recordAudit(plane, {
        id: randomUUID(),
        owner: { type: app.ownerType, id: app.ownerId },
        actorId: session.userId,
        action: "approve",
        subject: `${phase}:${app.remoteId}`,
      });
    }
  }
}

export async function importLocalApprovals(
  event: { sender: { id: number } },
  appId: number,
  phases: string[],
): Promise<void> {
  for (const phase of phases) {
    await approvePhase(event, appId, phase);
  }
}

export async function listPhaseComments(
  event: { sender: { id: number } },
  appId: number,
) {
  const { app } = await requireOwnedApp(event, appId, "view-page");
  const plane = await getControlPlaneDb();
  if (plane && app.remoteId) {
    const remote = await listControlComments(plane, app.remoteId);
    for (const row of remote) {
      const existing = db
        .select()
        .from(factoryPhaseComments)
        .where(eq(factoryPhaseComments.remoteId, row.id))
        .get();
      if (existing) continue;
      db.insert(factoryPhaseComments)
        .values({
          appId,
          phase: row.phase,
          memberId: row.memberId,
          memberName: row.memberName,
          body: row.body,
          remoteId: row.id,
          createdAt: row.createdAt,
        })
        .run();
    }
  }
  return db
    .select()
    .from(factoryPhaseComments)
    .where(eq(factoryPhaseComments.appId, appId))
    .all()
    .map((row) => ({
      id: row.id,
      phase: row.phase,
      memberId: row.memberId,
      memberName: row.memberName,
      body: row.body,
      createdAt: row.createdAt,
    }));
}

export async function addPhaseComment(
  event: { sender: { id: number } },
  appId: number,
  phase: string,
  body: string,
): Promise<void> {
  const text = body.trim();
  if (!text) {
    throw new DyadError("Write a comment first.", DyadErrorKind.Validation);
  }
  const { app, session } = await requireOwnedApp(event, appId, "comment");
  const member = memberLabel(session);
  const remoteId = randomUUID();
  db.insert(factoryPhaseComments)
    .values({
      appId,
      phase,
      memberId: member.memberId,
      memberName: member.memberName,
      body: text,
      remoteId,
    })
    .run();
  const plane = await getControlPlaneDb();
  if (plane && app.remoteId) {
    await insertControlComment(plane, {
      id: remoteId,
      appId: app.remoteId,
      phase,
      memberId: member.memberId,
      memberName: member.memberName,
      body: text,
    });
  }
}

export async function setAnswerLock(
  event: { sender: { id: number } },
  chatId: number,
  active: boolean,
): Promise<void> {
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
  if (!chat) throw new DyadError("Chat not found", DyadErrorKind.NotFound);
  const { session } = await requireOwnedApp(event, chat.appId, "comment");
  const member = memberLabel(session);
  if (!active) {
    const current = db
      .select()
      .from(answerLocks)
      .where(eq(answerLocks.chatId, chatId))
      .get();
    if (current && current.memberId === member.memberId) {
      db.delete(answerLocks).where(eq(answerLocks.chatId, chatId)).run();
    }
    const plane = await getControlPlaneDb();
    if (plane && chat.remoteId) {
      await deleteAnswerLock(plane, chat.remoteId);
    }
    return;
  }
  const expiresAt = new Date(Date.now() + LOCK_MS);
  db.insert(answerLocks)
    .values({
      chatId,
      memberId: member.memberId || "local",
      memberName: member.memberName || "Someone",
      expiresAt,
    })
    .onConflictDoUpdate({
      target: answerLocks.chatId,
      set: {
        memberId: member.memberId || "local",
        memberName: member.memberName || "Someone",
        expiresAt,
      },
    })
    .run();
  const plane = await getControlPlaneDb();
  if (plane && chat.remoteId) {
    await upsertAnswerLock(plane, {
      chatId: chat.remoteId,
      memberId: member.memberId || "local",
      memberName: member.memberName || "Someone",
      expiresAt,
    });
  }
}

export async function getAnswerLock(
  event: { sender: { id: number } },
  chatId: number,
): Promise<{
  memberId: string;
  memberName: string;
  expiresAt: Date;
} | null> {
  const chat = db.select().from(chats).where(eq(chats.id, chatId)).get();
  if (!chat) return null;
  await requireOwnedApp(event, chat.appId, "view-page");
  const row = db
    .select()
    .from(answerLocks)
    .where(eq(answerLocks.chatId, chatId))
    .get();
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    db.delete(answerLocks).where(eq(answerLocks.chatId, chatId)).run();
    return null;
  }
  return {
    memberId: row.memberId,
    memberName: row.memberName,
    expiresAt: row.expiresAt,
  };
}
