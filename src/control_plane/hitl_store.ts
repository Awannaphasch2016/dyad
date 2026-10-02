import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AdminRoleId } from "@/lib/adminAccess";
import { isAdminRoleId } from "@/lib/adminAccess";
import type { ControlPlaneDb } from "./db";
import {
  controlAnswers,
  controlMemberships,
  controlQuestions,
  controlRoles,
} from "./schema";
import {
  WEWEBPLUS_DEVELOPER_USER_ID,
  WEWEBPLUS_ORG_ID,
  WEWEBPLUS_PROJECT_MANAGER_USER_ID,
  type HitlQuestionRecord,
} from "./hitl";

const ROLE_NAMES: Record<AdminRoleId, string> = {
  "project-manager": "Project Manager",
  developer: "Developer",
};

export async function ensureOrgRoles(
  plane: ControlPlaneDb,
  orgId: string,
): Promise<void> {
  for (const roleId of Object.keys(ROLE_NAMES) as AdminRoleId[]) {
    const existing = await plane
      .select()
      .from(controlRoles)
      .where(
        and(eq(controlRoles.orgId, orgId), eq(controlRoles.roleId, roleId)),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await plane.insert(controlRoles).values({
      orgId,
      roleId,
      name: ROLE_NAMES[roleId],
    });
  }
}

export async function seedWewebplusMemberships(
  plane: ControlPlaneDb,
): Promise<void> {
  await ensureOrgRoles(plane, WEWEBPLUS_ORG_ID);
  const rows: Array<[string, AdminRoleId]> = [
    [WEWEBPLUS_PROJECT_MANAGER_USER_ID, "project-manager"],
    [WEWEBPLUS_DEVELOPER_USER_ID, "developer"],
  ];
  for (const [userId, roleId] of rows) {
    const existing = await plane
      .select()
      .from(controlMemberships)
      .where(
        and(
          eq(controlMemberships.userId, userId),
          eq(controlMemberships.orgId, WEWEBPLUS_ORG_ID),
        ),
      )
      .limit(1);
    if (existing.length > 0) continue;
    await plane.insert(controlMemberships).values({
      userId,
      orgId: WEWEBPLUS_ORG_ID,
      roleId,
    });
  }
}

export async function readMembershipRole(
  plane: ControlPlaneDb,
  orgId: string,
  userId: string,
): Promise<AdminRoleId | null> {
  const rows = await plane
    .select()
    .from(controlMemberships)
    .where(
      and(
        eq(controlMemberships.orgId, orgId),
        eq(controlMemberships.userId, userId),
      ),
    )
    .limit(1);
  const roleId = rows[0]?.roleId;
  if (!isAdminRoleId(roleId)) return null;
  const role = await plane
    .select()
    .from(controlRoles)
    .where(and(eq(controlRoles.orgId, orgId), eq(controlRoles.roleId, roleId)))
    .limit(1);
  if (role.length === 0) return null;
  return roleId;
}

export async function mirrorQuestion(
  plane: ControlPlaneDb,
  question: HitlQuestionRecord,
): Promise<void> {
  const existing = await plane
    .select()
    .from(controlQuestions)
    .where(eq(controlQuestions.id, question.id))
    .limit(1);
  if (existing.length === 0) {
    await plane.insert(controlQuestions).values({
      id: question.id,
      orgId: question.orgId,
      appId: question.appId,
      phase: question.phase,
      runId: question.runId,
      stepId: question.stepId,
      targetRoleId: question.targetRoleId,
      visibility: question.visibility,
      status: question.status,
      body: question.body,
      idempotencyKey: question.idempotencyKey,
      createdAt: question.createdAt,
      beadId: question.beadId,
      answeredByUserId: question.answeredByUserId,
      answeredByName: question.answeredByName,
      answeredAt: question.answeredAt,
    });
    return;
  }
  await plane
    .update(controlQuestions)
    .set({
      status: question.status,
      beadId: question.beadId,
      answeredByUserId: question.answeredByUserId,
      answeredByName: question.answeredByName,
      answeredAt: question.answeredAt,
    })
    .where(eq(controlQuestions.id, question.id));
}

export async function mirrorAnswer(
  plane: ControlPlaneDb,
  input: { questionId: string; userId: string; body: string; createdAt: Date },
): Promise<void> {
  const existing = await plane
    .select()
    .from(controlAnswers)
    .where(eq(controlAnswers.questionId, input.questionId))
    .limit(1);
  if (existing.length > 0) return;
  await plane.insert(controlAnswers).values({
    id: randomUUID(),
    questionId: input.questionId,
    userId: input.userId,
    body: input.body,
    createdAt: input.createdAt,
  });
}
