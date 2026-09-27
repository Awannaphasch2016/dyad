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
import { escapeXmlContent } from "../../shared/xmlEscape";
import { computeChatTurnPayloadHash } from "@/ipc/utils/chat_turn_intent_hash";
import { dispatchChatIntentAndWait } from "@/ipc/services/chat_actor_service";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";

export type FactoryHostDatabase = typeof productionDb;

export class FactoryHostError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
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
  return {
    appId,
    factoryHostManaged: app.factoryHostManaged,
    gasCityProjectId: app.gasCityProjectId,
    approvedPhases: approvals,
  };
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

  const terminalOutcome =
    intent?.recovery === "terminal" ? intent.terminalOutcome : null;
  const status =
    run.acceptance === "rejected" || intent?.acceptance === "rejected"
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

  const finalMessage =
    terminalOutcome && intent?.acceptedMessageId
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
  };
}

export async function startFactoryRun(
  database: FactoryHostDatabase,
  input: {
    appId: number;
    phase: FactoryPhase;
    prompt: string;
    idempotencyKey: string;
  },
  dispatch?: typeof dispatchChatIntentAndWait,
) {
  const state = readFactoryState(database, input.appId);
  if (!state.factoryHostManaged) {
    throw new FactoryHostError("App is not linked to Gas City", 409);
  }
  const chatId = resolveFactoryPhaseChats(database, input.appId)[input.phase];
  const runId = `gas-city-run:${sha256(
    `${input.appId}\0${input.phase}\0${input.idempotencyKey}`,
  )}`;
  const promptHash = sha256(input.prompt);
  const intentId = runId;
  const existing = database
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
  if (!existing) {
    database
      .insert(factoryHostRuns)
      .values({
        runId,
        appId: input.appId,
        chatId,
        phase: input.phase,
        idempotencyKey: input.idempotencyKey,
        promptHash,
        intentId,
      })
      .run();
  }

  const withoutHash = {
    schemaVersion: 1 as const,
    intentId,
    chatId,
    appId: input.appId,
    invocationRef: {
      kind: "chat-stream" as const,
      entityKey: chatId,
      operationId: `${runId}:stream`,
    },
    prompt: input.prompt,
    selectedComponents: [],
    requestedChatMode: "local-agent" as const,
  };
  const intent: SerializableChatTurnIntent = {
    ...withoutHash,
    payloadHash: computeChatTurnPayloadHash(withoutHash),
  };
  const persistAcceptance = (acceptance: "accepted" | "rejected") => {
    database
      .update(factoryHostRuns)
      .set({
        acceptance: acceptance === "accepted" ? "accepted" : "rejected",
        updatedAt: new Date(),
      })
      .where(eq(factoryHostRuns.runId, runId))
      .run();
  };
  const dispatchResult = (dispatch ?? dispatchChatIntentAndWait)(intent).then(
    (acceptance) => ({ kind: "settled" as const, acceptance }),
    () => ({ kind: "failed" as const }),
  );
  const initial = await Promise.race([
    dispatchResult,
    new Promise<{ kind: "pending" }>((resolve) =>
      setTimeout(() => resolve({ kind: "pending" }), 50),
    ),
  ]);
  if (initial.kind === "settled") {
    persistAcceptance(initial.acceptance);
  } else if (initial.kind === "failed") {
    persistAcceptance("rejected");
    throw new FactoryHostError("Run was not admitted by the chat actor", 409);
  } else {
    void dispatchResult.then((result) => {
      persistAcceptance(
        result.kind === "settled" ? result.acceptance : "rejected",
      );
    });
  }
  return readFactoryRun(database, runId);
}
