import { describe, expect, it } from "vitest";
import {
  HOOK_ATTEMPT_BUDGET,
  initialPhaseMachine,
  type PhaseMachineEvent,
  type PhaseMachineState,
  type PhaseMachineStatus,
} from "./state";
import { ignore, transitionPhase } from "./transition";

const FINISH = "## Phase finished\n- **Page name:** Northwind";

function state(
  status: PhaseMachineStatus,
  patch: Partial<PhaseMachineState> = {},
): PhaseMachineState {
  return {
    ...initialPhaseMachine("discovery"),
    status,
    openQuestionId: status === "waiting_for_answer" ? "q1" : null,
    finishText: status === "running_hooks" ? FINISH : null,
    ...patch,
  };
}

const events: PhaseMachineEvent[] = [
  { type: "entered" },
  { type: "question_opened", questionId: "q1" },
  { type: "answer_submitted", questionId: "q1", answer: "Northwind" },
  { type: "answer_submitted", questionId: "stale", answer: "no" },
  { type: "agent_finished", finishText: FINISH },
  { type: "agent_stopped_unclear", reason: "stopped" },
  { type: "agent_failed", reason: "boom" },
  { type: "hooks_succeeded", summary: "summary" },
  { type: "hooks_failed", reason: "missing" },
  { type: "approve" },
  { type: "reject", feedback: "Use a shorter name" },
  { type: "reject", feedback: "   " },
  { type: "retry" },
];

function eventKey(event: PhaseMachineEvent): string {
  if (event.type === "answer_submitted") {
    return `answer_submitted:${event.questionId}`;
  }
  if (event.type === "reject") {
    return event.feedback.trim() ? "reject" : "reject-empty";
  }
  return event.type;
}

describe("transitionPhase", () => {
  it("covers every status and event", () => {
    const statuses: PhaseMachineStatus[] = [
      "locked",
      "executing",
      "waiting_for_answer",
      "running_hooks",
      "awaiting_review",
      "approved",
      "incomplete",
      "failed",
    ];
    const seen = new Set<string>();
    for (const status of statuses) {
      for (const event of events) {
        const current = state(status);
        const result = transitionPhase(current, event);
        seen.add(`${status}:${eventKey(event)}`);
        if (result.kind === "ignored") {
          expect(result.state).toBe(current);
          expect(result.commands).toEqual([]);
        } else {
          expect(result.state).not.toBe(current);
        }
      }
    }
    expect(seen.size).toBe(statuses.length * events.length);
  });

  it("starts a locked phase and ignores a second enter", () => {
    const locked = initialPhaseMachine("implementation");
    const started = transitionPhase(locked, { type: "entered" });
    expect(started.kind).toBe("applied");
    if (started.kind !== "applied") return;
    expect(started.state.status).toBe("executing");
    expect(started.commands).toEqual([{ type: "start-agent" }]);
    expect(transitionPhase(started.state, { type: "entered" })).toEqual(
      ignore(started.state, "ignored-while-executing"),
    );
  });

  it("lets a question block finish, then resumes the same question", () => {
    const executing = state("executing");
    const waiting = transitionPhase(executing, {
      type: "question_opened",
      questionId: "q1",
    });
    expect(waiting).toMatchObject({
      kind: "applied",
      commands: [{ type: "open-question" }],
    });
    if (waiting.kind !== "applied") return;
    expect(
      transitionPhase(waiting.state, {
        type: "agent_finished",
        finishText: FINISH,
      }),
    ).toEqual(ignore(waiting.state, "ignored-while-waiting"));
    expect(
      transitionPhase(waiting.state, {
        type: "answer_submitted",
        questionId: "older",
        answer: "stale",
      }),
    ).toEqual(ignore(waiting.state, "stale-answer"));
    const resumed = transitionPhase(waiting.state, {
      type: "answer_submitted",
      questionId: "q1",
      answer: "Northwind",
    });
    expect(resumed).toMatchObject({
      kind: "applied",
      commands: [
        { type: "resume-agent", questionId: "q1", answer: "Northwind" },
      ],
    });
  });

  it("writes the summary only after an explicit finish", () => {
    const finished = transitionPhase(state("executing"), {
      type: "agent_finished",
      finishText: FINISH,
    });
    expect(finished.kind).toBe("applied");
    if (finished.kind !== "applied") return;
    expect(finished.state.status).toBe("running_hooks");
    expect(finished.commands).toEqual([{ type: "run-summary-hook" }]);
    const review = transitionPhase(finished.state, {
      type: "hooks_succeeded",
      summary: "## Discovery summary\n- **Page name:** Northwind",
    });
    expect(review.kind).toBe("applied");
    if (review.kind !== "applied") return;
    expect(review.state.status).toBe("awaiting_review");
    expect(review.state.summary).toContain("Discovery summary");
  });

  it("retries a hook without restarting the agent, then fails on the budget", () => {
    let current = state("running_hooks");
    for (let attempt = 1; attempt < HOOK_ATTEMPT_BUDGET; attempt += 1) {
      const failed = transitionPhase(current, {
        type: "hooks_failed",
        reason: "missing",
      });
      expect(failed.kind).toBe("applied");
      if (failed.kind !== "applied") return;
      expect(failed.state.status).toBe("running_hooks");
      expect(failed.state.hookAttempt).toBe(attempt);
      expect(failed.commands).toEqual([{ type: "retry-summary-hook" }]);
      current = failed.state;
    }
    const terminal = transitionPhase(current, {
      type: "hooks_failed",
      reason: "missing",
    });
    expect(terminal).toMatchObject({
      kind: "applied",
      commands: [{ type: "post-failure", reason: "missing" }],
    });
    if (terminal.kind !== "applied") return;
    expect(terminal.state.status).toBe("failed");
    expect(terminal.state.hookAttempt).toBe(HOOK_ATTEMPT_BUDGET);
  });

  it("approves discovery into the next phase and delivery into download", () => {
    const discovery = transitionPhase(state("awaiting_review"), {
      type: "approve",
    });
    expect(discovery).toMatchObject({
      kind: "applied",
      commands: [{ type: "record-approval" }, { type: "enter-next-phase" }],
    });
    const delivery = transitionPhase(
      state("awaiting_review", { phase: "delivery" }),
      { type: "approve" },
    );
    expect(delivery).toMatchObject({
      kind: "applied",
      commands: [{ type: "record-approval" }, { type: "enable-download" }],
    });
    if (delivery.kind !== "applied") return;
    expect(transitionPhase(delivery.state, { type: "approve" })).toEqual(
      ignore(delivery.state, "phase-already-approved"),
    );
  });

  it("rejects with feedback into the same phase and ignores an empty reject", () => {
    const reviewing = state("awaiting_review", { summary: "old" });
    expect(
      transitionPhase(reviewing, { type: "reject", feedback: "  " }),
    ).toEqual(ignore(reviewing, "empty-feedback"));
    const rejected = transitionPhase(reviewing, {
      type: "reject",
      feedback: "  Make the hero shorter  ",
    });
    expect(rejected.kind).toBe("applied");
    if (rejected.kind !== "applied") return;
    expect(rejected.state).toMatchObject({
      status: "executing",
      phase: "discovery",
      iteration: 2,
      summary: null,
      feedback: "Make the hero shorter",
    });
    expect(rejected.commands).toEqual([{ type: "start-agent" }]);
  });

  it("retries incomplete and failed work without opening review", () => {
    for (const status of ["incomplete", "failed"] as const) {
      const current = state(status, { failureReason: "stopped", iteration: 2 });
      expect(transitionPhase(current, { type: "approve" }).kind).toBe(
        "ignored",
      );
      const retried = transitionPhase(current, { type: "retry" });
      expect(retried.kind).toBe("applied");
      if (retried.kind !== "applied") return;
      expect(retried.state.status).toBe("executing");
      expect(retried.state.iteration).toBe(3);
      expect(retried.commands).toEqual([{ type: "start-agent" }]);
    }
  });

  it("fails a waiting phase when the agent can no longer take the answer", () => {
    const waiting = state("waiting_for_answer");
    const failed = transitionPhase(waiting, {
      type: "agent_failed",
      reason: "boom",
    });
    expect(failed.kind).toBe("applied");
    if (failed.kind !== "applied") return;
    expect(failed.state.status).toBe("failed");
    expect(failed.state.openQuestionId).toBeNull();
  });
});
