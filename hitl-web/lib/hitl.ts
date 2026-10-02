/** Same gate rules as src/control_plane/hitl.ts on the Wewebplus HITL branch. */

export const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";

export const GATE_ROLE = {
  "plan-approve": "project-manager",
  "review-approve-dev": "developer",
  "review-approve-pm": "project-manager",
} as const;

export type AdminRoleId = "project-manager" | "developer";

export function isAdminRoleId(value: unknown): value is AdminRoleId {
  return value === "project-manager" || value === "developer";
}

export interface HitlCaller {
  orgId: string;
  userId: string;
  roleId: AdminRoleId | null;
  displayName: string;
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
  body: string | null;
  canAnswer: boolean;
}

export type AnswerDecision =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "already-answered" }
  | { kind: "allow" };

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
    body: matching ? question.body : null,
    canAnswer: matching && question.status === "open",
  };
}

export function decideAnswer(
  question: HitlQuestionRecord,
  caller: HitlCaller | null,
): AnswerDecision {
  if (!caller || caller.orgId !== question.orgId) return { kind: "not-found" };
  if (caller.roleId !== question.targetRoleId) return { kind: "forbidden" };
  if (question.status !== "open") return { kind: "already-answered" };
  return { kind: "allow" };
}
