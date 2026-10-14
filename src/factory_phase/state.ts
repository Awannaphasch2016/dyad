import type { FactoryPhase } from "@/lib/factoryPhase";

/**
 * One factory phase. Discovery, Implementation, and Delivery share this
 * shape. The work prompt, approver, and hooks live outside the transition.
 */

export const PHASE_MACHINE_STATUSES = [
  "locked",
  "executing",
  "waiting_for_answer",
  "running_hooks",
  "awaiting_review",
  "approved",
  "incomplete",
  "failed",
] as const;

export type PhaseMachineStatus = (typeof PHASE_MACHINE_STATUSES)[number];

export const HOOK_ATTEMPT_BUDGET = 3;

export interface PhaseMachineState {
  readonly phase: FactoryPhase;
  readonly status: PhaseMachineStatus;
  readonly iteration: number;
  readonly openQuestionId: string | null;
  readonly hookAttempt: number;
  readonly summary: string | null;
  readonly feedback: string | null;
  readonly failureReason: string | null;
  readonly finishText: string | null;
}

export type PhaseMachineEvent =
  | { readonly type: "entered" }
  | { readonly type: "question_opened"; readonly questionId: string }
  | {
      readonly type: "answer_submitted";
      readonly questionId: string;
      readonly answer: string;
    }
  | { readonly type: "agent_finished"; readonly finishText: string }
  | { readonly type: "agent_stopped_unclear"; readonly reason: string }
  | { readonly type: "agent_failed"; readonly reason: string }
  | { readonly type: "hooks_succeeded"; readonly summary: string }
  | { readonly type: "hooks_failed"; readonly reason: string }
  | { readonly type: "approve" }
  | { readonly type: "reject"; readonly feedback: string }
  | { readonly type: "retry" };

export type PhaseMachineCommand =
  | { readonly type: "start-agent" }
  | { readonly type: "open-question" }
  | {
      readonly type: "resume-agent";
      readonly questionId: string;
      readonly answer: string;
    }
  | { readonly type: "run-summary-hook" }
  | { readonly type: "retry-summary-hook" }
  | { readonly type: "record-approval" }
  | { readonly type: "enter-next-phase" }
  | { readonly type: "enable-download" }
  | { readonly type: "post-incomplete"; readonly reason: string }
  | { readonly type: "post-failure"; readonly reason: string };

export interface PhaseTransitionApplied {
  readonly kind: "applied";
  readonly state: PhaseMachineState;
  readonly commands: readonly PhaseMachineCommand[];
}

export interface PhaseTransitionIgnored {
  readonly kind: "ignored";
  readonly state: PhaseMachineState;
  readonly reason: string;
  readonly commands: readonly [];
}

export type PhaseTransitionResult =
  | PhaseTransitionApplied
  | PhaseTransitionIgnored;

export function initialPhaseMachine(phase: FactoryPhase): PhaseMachineState {
  return {
    phase,
    status: "locked",
    iteration: 1,
    openQuestionId: null,
    hookAttempt: 0,
    summary: null,
    feedback: null,
    failureReason: null,
    finishText: null,
  };
}

export function phaseApproverRole(
  phase: FactoryPhase,
): "project-manager" | "developer" {
  return phase === "implementation" ? "developer" : "project-manager";
}
