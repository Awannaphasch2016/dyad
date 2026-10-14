import { createHash, randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import {
  factoryHostRuns,
  factoryPhaseApprovals,
  factoryPhaseMachines,
  hitlQuestions,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  FACTORY_PHASES,
  type FactoryPhase,
  nextFactoryPhase,
} from "@/lib/factoryPhase";
import { classifyFactoryStop, phaseSummaryFromFinish } from "@/lib/factoryStop";
import {
  initialPhaseMachine,
  phaseApproverRole,
  type PhaseMachineCommand,
  type PhaseMachineEvent,
  type PhaseMachineState,
  type PhaseMachineStatus,
} from "@/factory_phase/state";
import { transitionPhase } from "@/factory_phase/transition";
import { openFactoryRequestForRun } from "@/main/factory_host_request";
import {
  postFactoryHostMessage,
  readFactoryRun,
  resolveFactoryPhaseChats,
  type FactoryHostDatabase,
} from "@/main/factory_host_service";
import {
  cursorFactoryClientFromEnv,
  type CursorFactoryClient,
} from "@/main/cursor_factory_client";
import { startCursorPhase } from "@/main/cursor_factory_host";

const STATUSES = new Set<PhaseMachineStatus>([
  "locked",
  "executing",
  "waiting_for_answer",
  "running_hooks",
  "awaiting_review",
  "approved",
  "incomplete",
  "failed",
]);

function isPhase(value: string): value is FactoryPhase {
  return (FACTORY_PHASES as readonly string[]).includes(value);
}

function isStatus(value: string): value is PhaseMachineStatus {
  return STATUSES.has(value as PhaseMachineStatus);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function scriptedAgentText(
  state: PhaseMachineState,
  answer: string | null,
): string {
  if (answer != null && state.phase === "discovery") {
    return `## Phase finished
- **Page name:** Northwind
- **One sentence:** A one-page site recorded from Discovery through Delivery.
- **Page contents:** Hero, story, and visit. ${answer}`;
  }
  if (answer != null && state.phase === "implementation") {
    return `## Phase finished
- **Page:** Northwind index.html
- **Sections:** Hero, story, and visit
- **Changes this turn:** Built the one-page site. ${answer}`;
  }
  if (state.phase === "discovery") {
    return `## Request for project-manager

What is the page name, the one sentence, and what goes on the page?`;
  }
  if (state.phase === "implementation") {
    return `## Request for developer

Does the built page match the discovery summary?`;
  }
  return `## Phase finished
- **Page name:** Northwind
- **What it shows:** Hero, story, and visit
- **How to view it:** The app preview`;
}

function readState(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
): PhaseMachineState | null {
  const row = database
    .select()
    .from(factoryPhaseMachines)
    .where(
      and(
        eq(factoryPhaseMachines.appId, appId),
        eq(factoryPhaseMachines.phase, phase),
      ),
    )
    .get();
  if (!row || !isStatus(row.status)) return null;
  return {
    phase,
    status: row.status,
    iteration: row.iteration,
    openQuestionId: row.openQuestionId,
    hookAttempt: row.hookAttempt,
    summary: row.summary,
    feedback: row.feedback,
    failureReason: row.failureReason,
    finishText: row.finishText,
  };
}

function writeState(
  database: FactoryHostDatabase,
  appId: number,
  state: PhaseMachineState,
): void {
  database
    .insert(factoryPhaseMachines)
    .values({
      appId,
      phase: state.phase,
      status: state.status,
      iteration: state.iteration,
      openQuestionId: state.openQuestionId,
      hookAttempt: state.hookAttempt,
      summary: state.summary,
      feedback: state.feedback,
      failureReason: state.failureReason,
      finishText: state.finishText,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [factoryPhaseMachines.appId, factoryPhaseMachines.phase],
      set: {
        status: state.status,
        iteration: state.iteration,
        openQuestionId: state.openQuestionId,
        hookAttempt: state.hookAttempt,
        summary: state.summary,
        feedback: state.feedback,
        failureReason: state.failureReason,
        finishText: state.finishText,
        updatedAt: new Date(),
      },
    })
    .run();
}

function ensureRows(database: FactoryHostDatabase, appId: number): void {
  for (const phase of FACTORY_PHASES) {
    if (readState(database, appId, phase)) continue;
    writeState(database, appId, initialPhaseMachine(phase));
  }
}

function requireState(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
): PhaseMachineState {
  ensureRows(database, appId);
  const state = readState(database, appId, phase);
  if (!state) {
    throw new DyadError("Phase machine was not stored", DyadErrorKind.Internal);
  }
  return state;
}

interface RunContext {
  readonly script: boolean;
  readonly cursorClient: CursorFactoryClient | null;
  started: boolean;
}

function insertScriptRun(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    prompt: string;
    idempotencyKey: string;
  },
): string {
  const chatId = resolveFactoryPhaseChats(database, input.appId)[input.phase];
  const runId = input.idempotencyKey;
  database
    .insert(factoryHostRuns)
    .values({
      runId,
      appId: input.appId,
      chatId,
      phase: input.phase,
      idempotencyKey: input.idempotencyKey,
      promptHash: hash(input.prompt),
      intentId: runId,
      acceptance: "accepted",
    })
    .run();
  return runId;
}

function eventForScript(
  database: FactoryHostDatabase,
  appId: number,
  state: PhaseMachineState,
  text: string,
): PhaseMachineEvent {
  const stop = classifyFactoryStop({
    status: "finished",
    finalMessage: text,
    phase: state.phase,
  });
  if (stop === "question_opened") {
    const runId = insertScriptRun(database, {
      appId,
      phase: state.phase,
      prompt: text,
      idempotencyKey: `script-run:${state.phase}:${state.iteration}:${randomUUID()}`,
    });
    const opened = openFactoryRequestForRun(database, runId, text);
    if (!opened?.questionId) {
      return {
        type: "agent_stopped_unclear",
        reason: "The question was not stored.",
      };
    }
    return { type: "question_opened", questionId: opened.questionId };
  }
  if (stop === "agent_finished") {
    return { type: "agent_finished", finishText: text };
  }
  return {
    type: "agent_stopped_unclear",
    reason: "The turn ended without a finish.",
  };
}

async function runCommand(
  database: FactoryHostDatabase,
  appId: number,
  state: PhaseMachineState,
  command: PhaseMachineCommand,
  context: RunContext,
): Promise<PhaseMachineEvent | null> {
  switch (command.type) {
    case "start-agent": {
      if (context.script) {
        context.started = true;
        return eventForScript(
          database,
          appId,
          state,
          scriptedAgentText(state, null),
        );
      }
      const started = await startCursorPhase(database, context.cursorClient, {
        appId,
        phase: state.phase,
      });
      context.started = started.started;
      return null;
    }
    case "open-question":
      return null;
    case "resume-agent": {
      if (!context.script) return null;
      const question = database
        .select()
        .from(hitlQuestions)
        .where(eq(hitlQuestions.id, command.questionId))
        .get();
      const prompt = `${question?.body ?? ""}\n\n${command.answer}`;
      insertScriptRun(database, {
        appId,
        phase: state.phase,
        prompt,
        idempotencyKey: `script-follow:${state.phase}:${state.iteration}:${command.questionId}`,
      });
      return eventForScript(
        database,
        appId,
        state,
        scriptedAgentText(state, command.answer),
      );
    }
    case "run-summary-hook":
    case "retry-summary-hook": {
      const summary = phaseSummaryFromFinish(
        state.phase,
        state.finishText ?? "",
      );
      if (!summary) {
        return {
          type: "hooks_failed",
          reason: "The finish message has no bullets.",
        };
      }
      postFactoryHostMessage(database, {
        appId,
        phase: state.phase,
        role: "assistant",
        content: summary,
        idempotencyKey: `hook:${state.phase}:${state.iteration}:${state.hookAttempt}`,
      });
      return { type: "hooks_succeeded", summary };
    }
    case "record-approval": {
      const existing = database
        .select({ id: factoryPhaseApprovals.id })
        .from(factoryPhaseApprovals)
        .where(
          and(
            eq(factoryPhaseApprovals.appId, appId),
            eq(factoryPhaseApprovals.phase, state.phase),
          ),
        )
        .get();
      if (!existing) {
        database
          .insert(factoryPhaseApprovals)
          .values({
            appId,
            phase: state.phase,
            memberId: "phase-machine",
            memberName: "Phase machine",
            roleId: phaseApproverRole(state.phase),
          })
          .run();
      }
      return null;
    }
    case "enter-next-phase": {
      const next = nextFactoryPhase(state.phase);
      if (next) {
        await enterFactoryPhase(database, {
          appId,
          phase: next,
          script: context.script,
          cursorClient: context.cursorClient,
        });
      }
      return null;
    }
    case "enable-download":
      return null;
    case "post-incomplete":
    case "post-failure":
      postFactoryHostMessage(database, {
        appId,
        phase: state.phase,
        role: "system",
        content:
          command.type === "post-failure"
            ? `The run failed. ${command.reason}`
            : "Stopped before it finished. No question is open.",
        idempotencyKey: `${command.type}:${state.phase}:${state.iteration}`,
      });
      return null;
    default: {
      const neverCommand: never = command;
      throw new Error(`Unexpected phase command: ${String(neverCommand)}`);
    }
  }
}

async function applyAndRun(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
  event: PhaseMachineEvent,
  context: RunContext,
): Promise<PhaseMachineState> {
  let next: PhaseMachineEvent | null = event;
  let latest = requireState(database, appId, phase);
  for (let guard = 0; guard < 12 && next; guard += 1) {
    const current = requireState(database, appId, phase);
    const result = transitionPhase(current, next);
    next = null;
    if (result.kind === "ignored") return current;
    writeState(database, appId, result.state);
    latest = result.state;
    for (const command of result.commands) {
      const follow = await runCommand(
        database,
        appId,
        result.state,
        command,
        context,
      );
      if (follow) {
        next = follow;
        break;
      }
    }
  }
  return latest;
}

export function listFactoryPhaseMachines(
  database: FactoryHostDatabase,
  appId: number,
): PhaseMachineState[] {
  ensureRows(database, appId);
  return FACTORY_PHASES.map((phase) => requireState(database, appId, phase));
}

export function readFactoryPhaseMachine(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
): PhaseMachineState | null {
  return readState(database, appId, phase);
}

export async function enterFactoryPhase(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    script: boolean;
    cursorClient?: CursorFactoryClient | null;
  },
): Promise<{ started: boolean }> {
  const current = requireState(database, input.appId, input.phase);
  if (current.status !== "locked") return { started: true };
  const context: RunContext = {
    script: input.script,
    cursorClient:
      input.cursorClient === undefined
        ? cursorFactoryClientFromEnv()
        : input.cursorClient,
    started: input.script,
  };
  await applyAndRun(
    database,
    input.appId,
    input.phase,
    { type: "entered" },
    context,
  );
  return { started: context.started };
}

export async function answerFactoryPhase(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    questionId: string;
    answer: string;
    script: boolean;
  },
): Promise<void> {
  const question = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.id, input.questionId))
    .get();
  if (!question || !isPhase(question.phase)) return;
  await applyAndRun(
    database,
    input.appId,
    question.phase,
    {
      type: "answer_submitted",
      questionId: input.questionId,
      answer: input.answer,
    },
    {
      script: input.script,
      cursorClient: cursorFactoryClientFromEnv(),
      started: false,
    },
  );
}

export async function approveFactoryPhase(
  database: FactoryHostDatabase,
  input: { appId: number; phase: FactoryPhase; script: boolean },
): Promise<void> {
  const current = readState(database, input.appId, input.phase);
  if (current && current.status !== "awaiting_review") {
    throw new DyadError(
      "This phase is not ready for approval.",
      DyadErrorKind.Conflict,
    );
  }
  if (!current) return;
  await applyAndRun(
    database,
    input.appId,
    input.phase,
    { type: "approve" },
    {
      script: input.script,
      cursorClient: cursorFactoryClientFromEnv(),
      started: false,
    },
  );
}

export async function rejectFactoryPhase(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    feedback: string;
    script: boolean;
  },
): Promise<void> {
  if (input.feedback.trim().length === 0) {
    throw new DyadError(
      "Add feedback before sending this phase back.",
      DyadErrorKind.Validation,
    );
  }
  const current = requireState(database, input.appId, input.phase);
  if (current.status !== "awaiting_review") {
    throw new DyadError(
      "This phase is not ready for review.",
      DyadErrorKind.Conflict,
    );
  }
  await applyAndRun(
    database,
    input.appId,
    input.phase,
    { type: "reject", feedback: input.feedback },
    {
      script: input.script,
      cursorClient: null,
      started: false,
    },
  );
}

export async function retryFactoryPhase(
  database: FactoryHostDatabase,
  input: { appId: number; phase: FactoryPhase; script: boolean },
): Promise<void> {
  const current = requireState(database, input.appId, input.phase);
  if (current.status !== "incomplete" && current.status !== "failed") {
    throw new DyadError(
      "This phase is not waiting for a retry.",
      DyadErrorKind.Conflict,
    );
  }
  await applyAndRun(
    database,
    input.appId,
    input.phase,
    { type: "retry" },
    {
      script: input.script,
      cursorClient: cursorFactoryClientFromEnv(),
      started: false,
    },
  );
}

/** Apply a finished local Dyad turn to the phase machine when a row exists. */
export async function publishLocalFactoryStop(
  database: FactoryHostDatabase,
  runOrIntentId: string,
): Promise<void> {
  const stored = database
    .select()
    .from(factoryHostRuns)
    .where(
      or(
        eq(factoryHostRuns.runId, runOrIntentId),
        eq(factoryHostRuns.intentId, runOrIntentId),
      ),
    )
    .get();
  if (!stored || !isPhase(stored.phase)) return;
  const view = readFactoryRun(database, stored.runId);
  if (
    view.status !== "completed" &&
    view.status !== "errored" &&
    view.status !== "cancelled" &&
    view.status !== "rejected"
  ) {
    return;
  }
  const machine = readState(database, stored.appId, stored.phase);
  if (
    !machine ||
    (machine.status !== "executing" && machine.status !== "waiting_for_answer")
  ) {
    return;
  }
  const message = view.finalResult?.content ?? "";
  const stop = classifyFactoryStop({
    status: view.status,
    finalMessage: message,
    phase: stored.phase,
  });
  const context: RunContext = {
    script: false,
    cursorClient: null,
    started: false,
  };
  if (stop === "question_opened") {
    const opened = openFactoryRequestForRun(database, stored.runId, message);
    if (!opened?.questionId) return;
    await applyAndRun(
      database,
      stored.appId,
      stored.phase,
      { type: "question_opened", questionId: opened.questionId },
      context,
    );
    return;
  }
  if (stop === "agent_finished") {
    await applyAndRun(
      database,
      stored.appId,
      stored.phase,
      { type: "agent_finished", finishText: message },
      context,
    );
    return;
  }
  if (stop === "agent_failed") {
    await applyAndRun(
      database,
      stored.appId,
      stored.phase,
      { type: "agent_failed", reason: "The run failed." },
      context,
    );
    return;
  }
  await applyAndRun(
    database,
    stored.appId,
    stored.phase,
    {
      type: "agent_stopped_unclear",
      reason: "The turn ended without a finish.",
    },
    context,
  );
}

export function factoryScriptEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DYAD_FACTORY_SCRIPT === "record";
}
