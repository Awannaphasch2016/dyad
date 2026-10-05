import { isAdminRoleId, roleForGateStep, type AdminRoleId } from "./hitl_rules";

export {
  decideAnswer,
  GATE_ROLE,
  isAdminRoleId,
  presentQuestion,
  roleForGateStep,
  WEWEBPLUS_ORG_ID,
  type AdminRoleId,
  type AnswerDecision,
  type GateStepId,
  type HitlCaller,
  type HitlQuestionRecord,
  type HitlQuestionView,
} from "./hitl_rules";

export const WEWEBPLUS_PROJECT_MANAGER_USER_ID =
  "user_3Jo9AXjywP5QJtRbqTWJTn5sdxN";
export const WEWEBPLUS_DEVELOPER_USER_ID = "user_3K58joknYZ90Fts4yQC6yq4Enay";

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
