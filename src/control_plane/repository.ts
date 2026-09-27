import { and, eq } from "drizzle-orm";
import type { ControlPlaneDb } from "./db";
import type { AccountOwner } from "./owner";
import {
  controlAccountConnections,
  controlAnswerLocks,
  controlApps,
  controlAuditEvents,
  controlChats,
  controlKnowledgeItems,
  controlMessages,
  controlPhaseApprovals,
  controlPhaseComments,
} from "./schema";

type Plane = ControlPlaneDb;

export interface RemoteAppInput {
  id: string;
  owner: AccountOwner;
  name: string;
  slug: string;
  githubOrg: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  supabaseProjectId: string | null;
}

export async function insertControlApp(
  plane: Plane,
  input: RemoteAppInput,
): Promise<void> {
  await plane.insert(controlApps).values({
    id: input.id,
    ownerType: input.owner.type,
    ownerId: input.owner.id,
    name: input.name,
    slug: input.slug,
    githubOrg: input.githubOrg,
    githubRepo: input.githubRepo,
    githubBranch: input.githubBranch,
    supabaseProjectId: input.supabaseProjectId,
  });
}

export async function listControlApps(plane: Plane, owner: AccountOwner) {
  return plane
    .select()
    .from(controlApps)
    .where(
      and(
        eq(controlApps.ownerType, owner.type),
        eq(controlApps.ownerId, owner.id),
      ),
    );
}

export async function updateControlAppDetails(
  plane: Plane,
  appId: string,
  fields: {
    name: string;
    slug: string;
    githubOrg: string | null;
    githubRepo: string | null;
    githubBranch: string | null;
    supabaseProjectId: string | null;
  },
): Promise<void> {
  await plane.update(controlApps).set(fields).where(eq(controlApps.id, appId));
}

export async function deleteControlApp(
  plane: Plane,
  appId: string,
): Promise<void> {
  await plane.delete(controlApps).where(eq(controlApps.id, appId));
}

export async function updateControlChatTitle(
  plane: Plane,
  chatId: string,
  title: string | null,
): Promise<void> {
  await plane
    .update(controlChats)
    .set({ title })
    .where(eq(controlChats.id, chatId));
}

export async function updateControlMessageContent(
  plane: Plane,
  messageId: string,
  content: string,
): Promise<void> {
  await plane
    .update(controlMessages)
    .set({ content })
    .where(eq(controlMessages.id, messageId));
}

export async function updateControlAppOwner(
  plane: Plane,
  appId: string,
  owner: AccountOwner,
  fields?: {
    githubOrg?: string | null;
    githubRepo?: string | null;
    githubBranch?: string | null;
    supabaseProjectId?: string | null;
  },
): Promise<void> {
  await plane
    .update(controlApps)
    .set({
      ownerType: owner.type,
      ownerId: owner.id,
      ...fields,
    })
    .where(eq(controlApps.id, appId));
}

export async function insertControlChat(
  plane: Plane,
  input: { id: string; appId: string; title: string | null },
): Promise<void> {
  await plane.insert(controlChats).values(input);
}

export async function listControlChats(plane: Plane, appId: string) {
  return plane.select().from(controlChats).where(eq(controlChats.appId, appId));
}

export async function insertControlMessage(
  plane: Plane,
  input: { id: string; chatId: string; role: string; content: string },
): Promise<void> {
  await plane.insert(controlMessages).values(input);
}

export async function listControlMessages(plane: Plane, chatId: string) {
  return plane
    .select()
    .from(controlMessages)
    .where(eq(controlMessages.chatId, chatId));
}

export async function insertControlKnowledge(
  plane: Plane,
  input: {
    id: string;
    appId: string;
    title: string;
    url: string;
    addedBy: string;
  },
): Promise<void> {
  await plane.insert(controlKnowledgeItems).values(input);
}

export async function listControlKnowledge(plane: Plane, appId: string) {
  return plane
    .select()
    .from(controlKnowledgeItems)
    .where(eq(controlKnowledgeItems.appId, appId));
}

export async function listControlApprovals(plane: Plane, appId: string) {
  return plane
    .select()
    .from(controlPhaseApprovals)
    .where(eq(controlPhaseApprovals.appId, appId));
}

export async function upsertControlApproval(
  plane: Plane,
  input: {
    id: string;
    appId: string;
    phase: string;
    memberId: string;
    memberName: string;
    roleId: string;
  },
): Promise<void> {
  await plane
    .insert(controlPhaseApprovals)
    .values(input)
    .onConflictDoNothing({
      target: [controlPhaseApprovals.appId, controlPhaseApprovals.phase],
    });
}

export async function insertControlComment(
  plane: Plane,
  input: {
    id: string;
    appId: string;
    phase: string;
    memberId: string;
    memberName: string;
    body: string;
  },
): Promise<void> {
  await plane.insert(controlPhaseComments).values(input);
}

export async function listControlComments(plane: Plane, appId: string) {
  return plane
    .select()
    .from(controlPhaseComments)
    .where(eq(controlPhaseComments.appId, appId));
}

export async function recordAudit(
  plane: Plane,
  input: {
    id: string;
    owner: AccountOwner;
    actorId: string;
    action: string;
    subject: string;
  },
): Promise<void> {
  await plane.insert(controlAuditEvents).values({
    id: input.id,
    ownerType: input.owner.type,
    ownerId: input.owner.id,
    actorId: input.actorId,
    action: input.action,
    subject: input.subject,
  });
}

export async function upsertAnswerLock(
  plane: Plane,
  input: {
    chatId: string;
    memberId: string;
    memberName: string;
    expiresAt: Date;
  },
): Promise<void> {
  await plane
    .insert(controlAnswerLocks)
    .values(input)
    .onConflictDoUpdate({
      target: controlAnswerLocks.chatId,
      set: {
        memberId: input.memberId,
        memberName: input.memberName,
        expiresAt: input.expiresAt,
      },
    });
}

export async function readAnswerLock(plane: Plane, chatId: string) {
  const rows = await plane
    .select()
    .from(controlAnswerLocks)
    .where(eq(controlAnswerLocks.chatId, chatId));
  return rows[0] ?? null;
}

export async function deleteAnswerLock(
  plane: Plane,
  chatId: string,
): Promise<void> {
  await plane
    .delete(controlAnswerLocks)
    .where(eq(controlAnswerLocks.chatId, chatId));
}

export async function upsertAccountConnection(
  plane: Plane,
  input: {
    owner: AccountOwner;
    provider: "github" | "supabase";
    ciphertext: string;
    githubOrg: string | null;
  },
): Promise<void> {
  await plane
    .insert(controlAccountConnections)
    .values({
      ownerType: input.owner.type,
      ownerId: input.owner.id,
      provider: input.provider,
      ciphertext: input.ciphertext,
      githubOrg: input.githubOrg,
    })
    .onConflictDoUpdate({
      target: [
        controlAccountConnections.ownerType,
        controlAccountConnections.ownerId,
        controlAccountConnections.provider,
      ],
      set: {
        ciphertext: input.ciphertext,
        githubOrg: input.githubOrg,
      },
    });
}

export async function readAccountConnection(
  plane: Plane,
  owner: AccountOwner,
  provider: "github" | "supabase",
) {
  const rows = await plane
    .select()
    .from(controlAccountConnections)
    .where(
      and(
        eq(controlAccountConnections.ownerType, owner.type),
        eq(controlAccountConnections.ownerId, owner.id),
        eq(controlAccountConnections.provider, provider),
      ),
    );
  return rows[0] ?? null;
}

export async function listAuditEvents(plane: Plane, owner: AccountOwner) {
  return plane
    .select()
    .from(controlAuditEvents)
    .where(
      and(
        eq(controlAuditEvents.ownerType, owner.type),
        eq(controlAuditEvents.ownerId, owner.id),
      ),
    );
}
