import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const PhaseApprovalSchema = z.object({
  phase: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  roleId: z.string(),
  approvedAt: z.date(),
});

export const PhaseCommentSchema = z.object({
  id: z.number(),
  phase: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  body: z.string(),
  createdAt: z.date(),
});

export const AnswerLockSchema = z
  .object({
    memberId: z.string(),
    memberName: z.string(),
    expiresAt: z.date(),
  })
  .nullable();

export const HitlQuestionViewSchema = z.object({
  id: z.string(),
  stepId: z.string(),
  targetRoleId: z.enum(["project-manager", "developer"]),
  status: z.enum(["open", "answered"]),
  createdAt: z.string(),
  answeredByUserId: z.string().nullable(),
  answeredByName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  beadId: z.string().nullable(),
  body: z.string().nullable(),
  canAnswer: z.boolean(),
});

export const PhaseMachineSchema = z.object({
  phase: z.enum(["discovery", "implementation", "delivery"]),
  status: z.enum([
    "locked",
    "executing",
    "waiting_for_answer",
    "running_hooks",
    "awaiting_review",
    "approved",
    "incomplete",
    "failed",
  ]),
  iteration: z.number(),
  openQuestionId: z.string().nullable(),
  hookAttempt: z.number(),
  summary: z.string().nullable(),
  feedback: z.string().nullable(),
  failureReason: z.string().nullable(),
  finishText: z.string().nullable(),
});

export const factoryContracts = {
  listApprovals: defineContract({
    channel: "factory:list-approvals",
    input: z.object({ appId: z.number() }),
    output: z.object({ approvals: z.array(PhaseApprovalSchema) }),
  }),
  approve: defineContract({
    channel: "factory:approve",
    input: z.object({ appId: z.number(), phase: z.string() }),
    output: z.void(),
  }),
  importApprovals: defineContract({
    channel: "factory:import-approvals",
    input: z.object({ appId: z.number(), phases: z.array(z.string()) }),
    output: z.void(),
  }),
  listComments: defineContract({
    channel: "factory:list-comments",
    input: z.object({ appId: z.number() }),
    output: z.object({ comments: z.array(PhaseCommentSchema) }),
  }),
  addComment: defineContract({
    channel: "factory:add-comment",
    input: z.object({
      appId: z.number(),
      phase: z.string(),
      body: z.string(),
    }),
    output: z.void(),
  }),
  setAnswerLock: defineContract({
    channel: "factory:set-answer-lock",
    input: z.object({ chatId: z.number(), active: z.boolean() }),
    output: z.void(),
  }),
  getAnswerLock: defineContract({
    channel: "factory:get-answer-lock",
    input: z.object({ chatId: z.number() }),
    output: AnswerLockSchema,
  }),
  ensureCursorPhase: defineContract({
    channel: "factory:ensure-cursor-phase",
    input: z.object({
      appId: z.number(),
      phase: z.enum(["discovery", "implementation", "delivery"]),
    }),
    output: z.object({ started: z.boolean() }),
  }),
  listQuestions: defineContract({
    channel: "factory:list-questions",
    input: z.object({
      appId: z.number(),
      phase: z.enum(["discovery", "implementation", "delivery"]),
    }),
    output: z.object({ questions: z.array(HitlQuestionViewSchema) }),
  }),
  listPhaseMachines: defineContract({
    channel: "factory:list-phase-machines",
    input: z.object({ appId: z.number() }),
    output: z.object({ machines: z.array(PhaseMachineSchema) }),
  }),
  rejectPhase: defineContract({
    channel: "factory:reject-phase",
    input: z.object({
      appId: z.number(),
      phase: z.enum(["discovery", "implementation", "delivery"]),
      feedback: z.string(),
    }),
    output: z.void(),
  }),
  retryPhase: defineContract({
    channel: "factory:retry-phase",
    input: z.object({
      appId: z.number(),
      phase: z.enum(["discovery", "implementation", "delivery"]),
    }),
    output: z.void(),
  }),
  answerQuestion: defineContract({
    channel: "factory:answer-question",
    input: z.object({
      appId: z.number(),
      questionId: z.string(),
      body: z.string(),
    }),
    output: z.object({
      question: HitlQuestionViewSchema,
      resolved: z.boolean(),
    }),
  }),
} as const;

export const factoryClient = createClient(factoryContracts);
