import { nextFactoryPhase } from "@/lib/factoryPhase";
import {
  HOOK_ATTEMPT_BUDGET,
  type PhaseMachineCommand,
  type PhaseMachineEvent,
  type PhaseMachineState,
  type PhaseTransitionResult,
} from "./state";

function apply(
  state: PhaseMachineState,
  commands: readonly PhaseMachineCommand[],
): PhaseTransitionResult {
  return { kind: "applied", state, commands };
}

/** Same state reference, no commands. Deliberate no-ops stay visible. */
export function ignore(
  state: PhaseMachineState,
  reason: string,
): PhaseTransitionResult {
  return { kind: "ignored", state, reason, commands: [] };
}

function executing(
  state: PhaseMachineState,
  patch: Partial<PhaseMachineState> = {},
): PhaseMachineState {
  return {
    ...state,
    status: "executing",
    openQuestionId: null,
    hookAttempt: 0,
    failureReason: null,
    finishText: null,
    ...patch,
  };
}

/**
 * Total transition for one phase. Side effects are commands. A request that
 * is already open blocks finish. Empty reject stays in review.
 */
export function transitionPhase(
  state: PhaseMachineState,
  event: PhaseMachineEvent,
): PhaseTransitionResult {
  switch (state.status) {
    case "locked":
      return event.type === "entered"
        ? apply(executing(state), [{ type: "start-agent" }])
        : ignore(state, "phase-is-locked");
    case "executing":
      switch (event.type) {
        case "question_opened":
          return apply(
            {
              ...state,
              status: "waiting_for_answer",
              openQuestionId: event.questionId,
            },
            [{ type: "open-question" }],
          );
        case "agent_finished":
          return apply(
            {
              ...state,
              status: "running_hooks",
              hookAttempt: 0,
              finishText: event.finishText,
            },
            [{ type: "run-summary-hook" }],
          );
        case "agent_stopped_unclear":
          return apply(
            {
              ...state,
              status: "incomplete",
              failureReason: event.reason,
            },
            [{ type: "post-incomplete", reason: event.reason }],
          );
        case "agent_failed":
          return apply(
            { ...state, status: "failed", failureReason: event.reason },
            [{ type: "post-failure", reason: event.reason }],
          );
        default:
          return ignore(state, "ignored-while-executing");
      }
    case "waiting_for_answer":
      if (event.type === "answer_submitted") {
        if (event.questionId !== state.openQuestionId) {
          return ignore(state, "stale-answer");
        }
        return apply(executing(state), [
          {
            type: "resume-agent",
            questionId: event.questionId,
            answer: event.answer,
          },
        ]);
      }
      if (event.type === "agent_failed") {
        return apply(
          {
            ...state,
            status: "failed",
            openQuestionId: null,
            failureReason: event.reason,
          },
          [{ type: "post-failure", reason: event.reason }],
        );
      }
      return ignore(state, "ignored-while-waiting");
    case "running_hooks":
      if (event.type === "hooks_succeeded") {
        return apply(
          {
            ...state,
            status: "awaiting_review",
            hookAttempt: 0,
            summary: event.summary,
            failureReason: null,
          },
          [],
        );
      }
      if (event.type === "hooks_failed") {
        const hookAttempt = state.hookAttempt + 1;
        if (hookAttempt >= HOOK_ATTEMPT_BUDGET) {
          return apply(
            {
              ...state,
              status: "failed",
              hookAttempt,
              failureReason: event.reason,
            },
            [{ type: "post-failure", reason: event.reason }],
          );
        }
        return apply({ ...state, hookAttempt, failureReason: event.reason }, [
          { type: "retry-summary-hook" },
        ]);
      }
      return ignore(state, "ignored-while-writing-summary");
    case "awaiting_review":
      if (event.type === "approve") {
        const commands: PhaseMachineCommand[] = [{ type: "record-approval" }];
        if (nextFactoryPhase(state.phase)) {
          commands.push({ type: "enter-next-phase" });
        } else {
          commands.push({ type: "enable-download" });
        }
        return apply(
          {
            ...state,
            status: "approved",
            openQuestionId: null,
            feedback: null,
          },
          commands,
        );
      }
      if (event.type === "reject") {
        if (event.feedback.trim().length === 0) {
          return ignore(state, "empty-feedback");
        }
        return apply(
          executing(state, {
            iteration: state.iteration + 1,
            summary: null,
            feedback: event.feedback.trim(),
          }),
          [{ type: "start-agent" }],
        );
      }
      return ignore(state, "ignored-while-in-review");
    case "incomplete":
    case "failed":
      if (event.type === "retry") {
        return apply(
          executing(state, {
            iteration: state.iteration + 1,
            summary: null,
            feedback: null,
          }),
          [{ type: "start-agent" }],
        );
      }
      return ignore(state, "ignored-until-retry");
    case "approved":
      return ignore(state, "phase-already-approved");
    default: {
      const neverStatus: never = state.status;
      throw new Error(`Unexpected phase status: ${String(neverStatus)}`);
    }
  }
}
