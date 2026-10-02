import type { AdminRoleId } from "@/lib/adminAccess";
import { isAdminRoleId } from "@/lib/adminAccess";

/** Gate step ids from the approval formula. The role is not a bd gate field. */
export const GATE_ROLE = {
  "plan-approve": "project-manager",
  "review-approve-dev": "developer",
  "review-approve-pm": "project-manager",
} as const satisfies Record<string, AdminRoleId>;

export type GateStepId = keyof typeof GATE_ROLE;

export const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";
export const WEWEBPLUS_PROJECT_MANAGER_USER_ID =
  "user_3Jo9AXjywP5QJtRbqTWJTn5sdxN";
export const WEWEBPLUS_DEVELOPER_USER_ID = "user_3K58joknYZ90Fts4yQC6yq4Enay";

export interface HitlCaller {
  orgId: string;
  userId: string;
  roleId: AdminRoleId | null;
  displayName: string | null;
}

export interface HitlQuestionRecord {
  id: string;
  orgId: string;
  appId: string;
  phase: string;
  runId: string;
  stepId: string;
  targetRoleId: AdminRoleId;
  visibility: "role";
  status: "open" | "answered";
  body: string;
  idempotencyKey: string;
  createdAt: Date;
  beadId: string | null;
  answeredByUserId: string | null;
  answeredByName: string | null;
  answeredAt: Date | null;
}

export interface HitlQuestionView {
  id: string;
  stepId: string;
  targetRoleId: AdminRoleId;
  status: "open" | "answered";
  createdAt: string;
  answeredByUserId: string | null;
  answeredByName: string | null;
  answeredAt: string | null;
  beadId: string | null;
  body: string | null;
  canAnswer: boolean;
}

export function roleForGateStep(stepId: string): AdminRoleId | null {
  if (!Object.prototype.hasOwnProperty.call(GATE_ROLE, stepId)) return null;
  return GATE_ROLE[stepId as GateStepId];
}

export function assertGateRole(
  stepId: string,
  targetRoleId: string,
): AdminRoleId {
  const expected = roleForGateStep(stepId);
  if (!expected || !isAdminRoleId(targetRoleId) || targetRoleId !== expected) {
    throw new Error(
      `${stepId} is not a gate for ${targetRoleId || "that role"}`,
    );
  }
  return expected;
}

/**
 * Same organization sees status. The body and the answer control exist only
 * for the membership role the question names. Any other organization is absent.
 */
export function presentQuestion(
  question: HitlQuestionRecord,
  caller: HitlCaller | null,
): HitlQuestionView | null {
  if (!caller || caller.orgId !== question.orgId) return null;
  const matching = caller.roleId === question.targetRoleId;
  return {
    id: question.id,
    stepId: question.stepId,
    targetRoleId: question.targetRoleId,
    status: question.status,
    createdAt: question.createdAt.toISOString(),
    answeredByUserId: question.answeredByUserId,
    answeredByName: question.answeredByName,
    answeredAt: question.answeredAt ? question.answeredAt.toISOString() : null,
    beadId: question.beadId,
    body: matching ? question.body : null,
    canAnswer: matching && question.status === "open",
  };
}

export type AnswerDecision =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "already-answered" }
  | { kind: "allow" };

export function decideAnswer(
  question: HitlQuestionRecord,
  caller: HitlCaller | null,
): AnswerDecision {
  if (!caller || caller.orgId !== question.orgId) return { kind: "not-found" };
  if (caller.roleId !== question.targetRoleId) return { kind: "forbidden" };
  if (question.status !== "open") return { kind: "already-answered" };
  return { kind: "allow" };
}
