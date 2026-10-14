import { createHash } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import type { db as productionDb } from "@/db";
import {
  apps,
  chatTurnIntents,
  chats,
  factoryHostMessages,
  factoryPhaseApprovals,
  factoryHostRuns,
  messages,
} from "@/db/schema";
import {
  FACTORY_PHASES,
  factoryPhaseChats,
  phaseFromTitle,
  type FactoryPhase,
} from "@/lib/factoryPhase";
import { closedFormulaPhases, formulaStep } from "@/lib/factoryFormula";
import { escapeXmlContent } from "../../shared/xmlEscape";

export type FactoryHostDatabase = typeof productionDb;

export class FactoryHostError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function chatIdForPhase(
  database: Pick<FactoryHostDatabase, "select">,
  appId: number,
  phase: FactoryPhase,
) {
  const rows = database
    .select({ id: chats.id, title: chats.title })
    .from(chats)
    .where(eq(chats.appId, appId))
    .orderBy(asc(chats.id))
    .all();
  const chatId = factoryPhaseChats(rows)[phase]?.id;
  if (!chatId) throw new FactoryHostError("Phase chat not found", 404);
  return chatId;
}

function requireApp(database: FactoryHostDatabase, appId: number) {
  const row = database.select().from(apps).where(eq(apps.id, appId)).get();
  if (!row) throw new FactoryHostError("App not found", 404);
  return row;
}

export function resolveFactoryPhaseChats(
  database: FactoryHostDatabase,
  appId: number,
) {
  requireApp(database, appId);
  const rows = database
    .select({ id: chats.id, title: chats.title })
    .from(chats)
    .where(eq(chats.appId, appId))
    .orderBy(asc(chats.id))
    .all();
  const resolved = factoryPhaseChats(rows);
  if (
    FACTORY_PHASES.some(
      (phase) =>
        rows.filter((row) => phaseFromTitle(row.title) === phase).length > 1,
    )
  ) {
    throw new FactoryHostError("App has duplicate factory phase chats", 409);
  }
  if (!FACTORY_PHASES.every((phase) => resolved[phase])) {
    throw new FactoryHostError(
      "App does not have all three factory phase chats",
      409,
    );
  }
  return {
    discovery: resolved.discovery!.id,
    implementation: resolved.implementation!.id,
    delivery: resolved.delivery!.id,
  };
}

export function readFactoryState(database: FactoryHostDatabase, appId: number) {
  const app = requireApp(database, appId);
  const approvals = database
    .select({ phase: factoryPhaseApprovals.phase })
    .from(factoryPhaseApprovals)
    .where(eq(factoryPhaseApprovals.appId, appId))
    .orderBy(asc(factoryPhaseApprovals.id))
    .all()
    .map((row) => row.phase);
  const formulaRun = latestFormulaRun(database, appId);
  const step = formulaStep(formulaRun?.currentStepId);
  const closedPhases = formulaRun?.formula
    ? closedFormulaPhases(
        formulaRun.currentStepId,
        formulaRun.orchestratorStatus,
      )
    : [];
  return {
    appId,
    factoryHostManaged: app.factoryHostManaged,
    gasCityProjectId: app.gasCityProjectId,
    approvedPhases: approvals,
    formula: formulaRun?.formula ?? null,
    currentStepId: formulaRun?.currentStepId ?? null,
    stepTitle: step?.title ?? null,
    openPhase: step?.phase ?? null,
    closedPhases,
    gateWaiting:
      formulaRun?.orchestratorStatus === "input-required" &&
      step?.gate === true,
    workflowTaskId: formulaRun?.runId ?? null,
  };
}

function latestFormulaRun(database: FactoryHostDatabase, appId: number) {
  const rows = database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.appId, appId))
    .all()
    .filter((row) => row.formula);
  rows.sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
  const open = rows.find(
    (row) =>
      row.orchestratorStatus !== "completed" &&
      row.orchestratorStatus !== "cancelled" &&
      row.orchestratorStatus !== "errored",
  );
  return open ?? rows[0] ?? null;
}

export function linkFactoryApp(
  database: FactoryHostDatabase,
  appId: number,
  gasCityProjectId: string,
) {
  requireApp(database, appId);
  database
    .update(apps)
    .set({
      factoryHostManaged: true,
      gasCityProjectId,
      updatedAt: new Date(),
    })
    .where(eq(apps.id, appId))
    .run();
  return readFactoryState(database, appId);
}

export function approveFactoryPhase(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
) {
  resolveFactoryPhaseChats(database, appId);
  database
    .insert(factoryPhaseApprovals)
    .values({ appId, phase })
    .onConflictDoNothing()
    .run();
  return readFactoryState(database, appId);
}

export function postFactoryHostMessage(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    role: "assistant" | "system";
    content: string;
    idempotencyKey: string;
  },
) {
  const phaseChats = resolveFactoryPhaseChats(database, input.appId);
  const chatId = phaseChats[input.phase];

  return database.transaction((tx) => {
    const existing = tx
      .select({
        messageId: factoryHostMessages.messageId,
        requestedRole: factoryHostMessages.requestedRole,
      })
      .from(factoryHostMessages)
      .where(
        and(
          eq(factoryHostMessages.chatId, chatId),
          eq(factoryHostMessages.idempotencyKey, input.idempotencyKey),
        ),
      )
      .get();
    if (existing) {
      return {
        chatId,
        messageId: existing.messageId,
        requestedRole: existing.requestedRole,
        storedRole: "assistant" as const,
        inserted: false,
      };
    }

    const content =
      input.role === "system"
        ? `<dyad-status title="Gas City" state="finished">\n${escapeXmlContent(input.content)}\n</dyad-status>`
        : input.content;
    const messageResult = tx
      .insert(messages)
      .values({ chatId, role: "assistant", content })
      .run();
    const messageId = Number(messageResult.lastInsertRowid);
    tx.insert(factoryHostMessages)
      .values({
        chatId,
        idempotencyKey: input.idempotencyKey,
        requestedRole: input.role,
        messageId,
      })
      .run();
    return {
      chatId,
      messageId,
      requestedRole: input.role,
      storedRole: "assistant" as const,
      inserted: true,
    };
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function readFactoryRun(database: FactoryHostDatabase, runId: string) {
  const run = database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.runId, runId))
    .get();
  if (!run) throw new FactoryHostError("Run not found", 404);
  const intent = database
    .select({
      acceptance: chatTurnIntents.acceptance,
      recovery: chatTurnIntents.recovery,
      terminalOutcome: chatTurnIntents.terminalOutcome,
      acceptedMessageId: chatTurnIntents.acceptedMessageId,
    })
    .from(chatTurnIntents)
    .where(eq(chatTurnIntents.intentId, run.intentId))
    .get();

  const orchestrated = run.orchestratorStatus;
  const terminalOutcome = orchestrated
    ? orchestrated === "completed" ||
      orchestrated === "cancelled" ||
      orchestrated === "errored"
      ? orchestrated
      : null
    : intent?.recovery === "terminal"
      ? intent.terminalOutcome
      : null;
  const status = orchestrated
    ? orchestrated
    : run.acceptance === "rejected" || intent?.acceptance === "rejected"
      ? "rejected"
      : terminalOutcome === "completed"
        ? "completed"
        : terminalOutcome === "cancelled"
          ? "cancelled"
          : terminalOutcome === "errored"
            ? "errored"
            : run.acceptance === "accepted" ||
                intent?.acceptance === "message-accepted"
              ? "running"
              : "queued";

  const finalMessage = orchestrated
    ? terminalOutcome && run.assistantMessageId
      ? database
          .select({ id: messages.id, content: messages.content })
          .from(messages)
          .where(eq(messages.id, run.assistantMessageId))
          .get()
      : undefined
    : terminalOutcome && intent?.acceptedMessageId
      ? database
          .select({ id: messages.id, content: messages.content })
          .from(messages)
          .where(
            and(
              eq(messages.chatId, run.chatId),
              eq(messages.role, "assistant"),
              gt(messages.id, intent.acceptedMessageId),
            ),
          )
          .orderBy(asc(messages.id))
          .get()
      : undefined;

  return {
    runId: run.runId,
    appId: run.appId,
    chatId: run.chatId,
    phase: run.phase,
    status,
    terminalOutcome,
    finalResult: finalMessage ?? null,
    gasCityTaskId: run.gasCityTaskId,
    eventCursor: run.eventCursor,
  };
}

export const FACTORY_EVENT_TYPES = [
  "text",
  "activity",
  "input-required",
  "end",
  "error",
] as const;
export type FactoryEventType = (typeof FACTORY_EVENT_TYPES)[number];

function factoryRunId(input: {
  appId: number;
  phase: FactoryPhase;
  idempotencyKey: string;
}): string {
  return `gas-city-run:${sha256(
    `${input.appId}\0${input.phase}\0${input.idempotencyKey}`,
  )}`;
}

/**
 * Record a factory task for GasCity. This does not start the local agent.
 * The same idempotency key and prompt returns the existing task.
 */
export function openOrchestratedRun(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    prompt: string;
    idempotencyKey: string;
    formula?: string;
  },
) {
  const state = readFactoryState(database, input.appId);
  if (!state.factoryHostManaged) {
    throw new FactoryHostError("App is not linked to Gas City", 409);
  }
  const chatId = resolveFactoryPhaseChats(database, input.appId)[input.phase];
  const runId = factoryRunId(input);
  const promptHash = sha256(input.prompt);
  database.transaction((tx) => {
    const existing = tx
      .select()
      .from(factoryHostRuns)
      .where(eq(factoryHostRuns.runId, runId))
      .get();
    if (existing && existing.promptHash !== promptHash) {
      throw new FactoryHostError(
        "Idempotency key was already used with a different prompt",
        409,
      );
    }
    if (existing) return;
    tx.insert(messages)
      .values({ chatId, role: "user", content: input.prompt })
      .run();
    const assistantMessageId = Number(
      tx
        .insert(messages)
        .values({ chatId, role: "assistant", content: "" })
        .run().lastInsertRowid,
    );
    tx.insert(factoryHostRuns)
      .values({
        runId,
        appId: input.appId,
        chatId,
        phase: input.phase,
        idempotencyKey: input.idempotencyKey,
        promptHash,
        intentId: runId,
        acceptance: "accepted",
        gasCityTaskId: runId,
        formula: input.formula ?? null,
        orchestratorStatus: "running",
        assistantMessageId,
      })
      .run();
  });
  return readFactoryRun(database, runId);
}

export async function startFactoryRun(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    prompt: string;
    idempotencyKey: string;
  },
) {
  return openOrchestratedRun(database, input);
}

function loadFactoryRun(
  database: Pick<FactoryHostDatabase, "select">,
  taskId: string,
) {
  return (
    database
      .select()
      .from(factoryHostRuns)
      .where(eq(factoryHostRuns.runId, taskId))
      .get() ??
    database
      .select()
      .from(factoryHostRuns)
      .where(eq(factoryHostRuns.gasCityTaskId, taskId))
      .get()
  );
}

export function applyFactoryHostEvent(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    taskId: string;
    cursor: number;
    type: FactoryEventType;
    content: string;
    stepId?: string | null;
  },
) {
  const step = input.stepId ? formulaStep(input.stepId) : null;
  if (input.stepId && !step) {
    throw new FactoryHostError("Unknown formula step", 400);
  }
  const applied = database.transaction((tx) => {
    const run = loadFactoryRun(tx, input.taskId);
    if (!run || run.appId !== input.appId) {
      throw new FactoryHostError("Run not found", 404);
    }
    if (!run.formula && run.phase !== input.phase) {
      throw new FactoryHostError("Run not found", 404);
    }
    if (step && step.phase !== input.phase) {
      throw new FactoryHostError("Formula step is not in this phase", 409);
    }
    if (input.cursor <= run.eventCursor) {
      return { runId: run.runId, appended: false };
    }
    if (input.cursor !== run.eventCursor + 1) {
      throw new FactoryHostError("Event cursor is not the next event", 409);
    }
    if (
      run.orchestratorStatus === "completed" ||
      run.orchestratorStatus === "cancelled" ||
      run.orchestratorStatus === "errored"
    ) {
      throw new FactoryHostError("Run is already finished", 409);
    }
    const nextChatId = step
      ? chatIdForPhase(tx, input.appId, step.phase)
      : run.chatId;
    const phaseChanged = nextChatId !== run.chatId;
    let assistantMessageId = phaseChanged ? null : run.assistantMessageId;
    if (input.content.length > 0) {
      if (assistantMessageId) {
        const row = tx
          .select({ content: messages.content })
          .from(messages)
          .where(eq(messages.id, assistantMessageId))
          .get();
        tx.update(messages)
          .set({ content: `${row?.content ?? ""}${input.content}` })
          .where(eq(messages.id, assistantMessageId))
          .run();
      } else {
        assistantMessageId = Number(
          tx
            .insert(messages)
            .values({
              chatId: nextChatId,
              role: "assistant",
              content: input.content,
            })
            .run().lastInsertRowid,
        );
      }
    }
    const orchestratorStatus =
      input.type === "end"
        ? "completed"
        : input.type === "error"
          ? "errored"
          : input.type === "input-required"
            ? "input-required"
            : "running";
    tx.update(factoryHostRuns)
      .set({
        assistantMessageId,
        chatId: nextChatId,
        phase: step?.phase ?? run.phase,
        currentStepId: step?.id ?? run.currentStepId,
        orchestratorStatus,
        eventCursor: input.cursor,
        updatedAt: new Date(),
      })
      .where(eq(factoryHostRuns.runId, run.runId))
      .run();
    return { runId: run.runId, appended: true };
  });
  return {
    ...readFactoryRun(database, applied.runId),
    appended: applied.appended,
  };
}

export function cancelFactoryHostRun(
  database: FactoryHostDatabase,
  runId: string,
) {
  const run = loadFactoryRun(database, runId);
  if (!run) throw new FactoryHostError("Run not found", 404);
  if (
    run.orchestratorStatus === "completed" ||
    run.orchestratorStatus === "errored"
  ) {
    throw new FactoryHostError("Run is already finished", 409);
  }
  if (run.orchestratorStatus !== "cancelled") {
    database
      .update(factoryHostRuns)
      .set({ orchestratorStatus: "cancelled", updatedAt: new Date() })
      .where(eq(factoryHostRuns.runId, run.runId))
      .run();
  }
  return readFactoryRun(database, run.runId);
}

export function markFactoryRunErrored(
  database: FactoryHostDatabase,
  runId: string,
) {
  const run = loadFactoryRun(database, runId);
  if (!run) return;
  if (
    run.orchestratorStatus === "completed" ||
    run.orchestratorStatus === "cancelled" ||
    run.orchestratorStatus === "errored"
  ) {
    return;
  }
  database
    .update(factoryHostRuns)
    .set({ orchestratorStatus: "errored", updatedAt: new Date() })
    .where(eq(factoryHostRuns.runId, run.runId))
    .run();
}
