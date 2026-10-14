import { ZodError } from "zod";
import { asc, eq } from "drizzle-orm";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { ChatStreamInvocationRef } from "@/chat_stream/invocation";
import type {
  ChatStreamChunkPayload,
  ChatStreamEndPayload,
} from "@/chat_stream/protocol";
import { apps, factoryHostRuns, messages } from "@/db/schema";
import { safeSend, type SafeSender } from "@/ipc/utils/safe_sender";
import {
  toRendererMessages,
  type RendererMessageRow,
} from "@/ipc/utils/renderer_chat_message";
import { phaseFromTitle, type FactoryPhase } from "@/lib/factoryPhase";
import { FACTORY_FORMULA, formulaStep } from "@/lib/factoryFormula";
import { getDyadAppPath } from "@/paths/paths";
import {
  invokeRegisteredToolByName,
  TOOL_DEFINITIONS,
} from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import { getToolConsent } from "@/pro/main/ipc/handlers/local_agent/tools/tool_invocation";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { closeMutationActor } from "@/pro/main/ipc/handlers/local_agent/subagents/mutation_activity_tracker";
import {
  applyFactoryHostEvent,
  cancelFactoryHostRun,
  FactoryHostError,
  markFactoryRunErrored,
  openOrchestratedRun,
  readFactoryState,
  type FactoryEventType,
  type FactoryHostDatabase,
} from "./factory_host_service";

/** Tools GasCity may call. Sandbox, sub-agents, and MCP stay off this list. */
export const FACTORY_TOOL_ALLOWLIST = [
  "read_file",
  "list_files",
  "grep",
  "code_search",
  "write_file",
  "search_replace",
  "git_status",
  "git_diff",
] as const;

const FACTORY_TOOL_NAMES = new Set<string>(FACTORY_TOOL_ALLOWLIST);
const MUTATING_FACTORY_TOOLS = new Set(["write_file", "search_replace"]);

type TurnOutcome = "completed" | "cancelled" | "errored";

type TurnResult = {
  outcome: TurnOutcome;
  errorMessage?: string;
};

type FactorySession = {
  sender: SafeSender;
  chatId: number;
  invocationRef?: ChatStreamInvocationRef;
  streamId?: number;
  updatedFiles: boolean;
  settled: boolean;
  resolve: (result: TurnResult) => void;
  done: Promise<TurnResult>;
};

const sessions = new Map<string, FactorySession>();
const taskAbortControllers = new Map<string, AbortController>();
const toolResults = new Map<string, Promise<string>>();

export function isFactoryOrchestratedChat(
  app: { factoryHostManaged: boolean },
  title: string | null | undefined,
): boolean {
  return app.factoryHostManaged === true && phaseFromTitle(title) !== null;
}

function taskAbortController(taskId: string): AbortController {
  const existing = taskAbortControllers.get(taskId);
  if (existing) return existing;
  const created = new AbortController();
  taskAbortControllers.set(taskId, created);
  return created;
}

function publishSession(
  database: FactoryHostDatabase,
  session: FactorySession,
): void {
  const rows = database
    .select({
      id: messages.id,
      chatTurnIntentId: messages.chatTurnIntentId,
      role: messages.role,
      content: messages.content,
      approvalState: messages.approvalState,
      sourceCommitHash: messages.sourceCommitHash,
      commitHash: messages.commitHash,
      requestId: messages.requestId,
      maxTokensUsed: messages.maxTokensUsed,
      model: messages.model,
      createdAt: messages.createdAt,
      isCompactionSummary: messages.isCompactionSummary,
    })
    .from(messages)
    .where(eq(messages.chatId, session.chatId))
    .orderBy(asc(messages.id))
    .all();
  safeSend(session.sender, "chat:response:chunk", {
    chatId: session.chatId,
    invocationRef: session.invocationRef,
    streamId: session.streamId,
    messages: toRendererMessages(rows as RendererMessageRow[]),
  } satisfies ChatStreamChunkPayload);
}

function finishSession(
  taskId: string,
  outcome: TurnOutcome,
  errorMessage?: string,
  sendEnd = false,
): void {
  const session = sessions.get(taskId);
  if (!session || session.settled) return;
  session.settled = true;
  if (sendEnd) {
    safeSend(session.sender, "chat:response:end", {
      chatId: session.chatId,
      invocationRef: session.invocationRef,
      streamId: session.streamId,
      updatedFiles: session.updatedFiles,
      wasCancelled: outcome === "cancelled",
    } satisfies ChatStreamEndPayload);
  }
  session.resolve({ outcome, errorMessage });
  sessions.delete(taskId);
  closeMutationActor(taskId);
}

export async function postFactoryOrchestrator(
  payload: Record<string, unknown>,
): Promise<void> {
  const url = process.env.GAS_CITY_ORCHESTRATOR_URL?.trim();
  if (!url) {
    throw new DyadError(
      "GasCity orchestrator URL is not configured.",
      DyadErrorKind.Precondition,
    );
  }
  const token = process.env.GAS_CITY_HOST_BRIDGE_TOKEN;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new DyadError(
      "GasCity orchestrator is unreachable.",
      DyadErrorKind.External,
    );
  }
  if (!response.ok) {
    throw new DyadError(
      "GasCity did not accept the factory turn.",
      DyadErrorKind.External,
    );
  }
}

export async function resumeFactoryTaskFromAnswer(input: {
  taskId: string;
  questionId: string;
  body: string;
}): Promise<void> {
  if (!process.env.GAS_CITY_ORCHESTRATOR_URL?.trim()) return;
  try {
    await postFactoryOrchestrator({
      type: "answer",
      taskId: input.taskId,
      questionId: input.questionId,
      body: input.body,
    });
  } catch (error) {
    throw new FactoryHostError(
      error instanceof Error
        ? error.message
        : "GasCity did not accept the answer.",
      502,
    );
  }
}

async function notifyFactoryCancel(taskId: string): Promise<void> {
  if (!process.env.GAS_CITY_ORCHESTRATOR_URL?.trim()) return;
  try {
    await postFactoryOrchestrator({ type: "cancel", taskId });
  } catch {
    return;
  }
}

function buildFactoryAgentContext(params: {
  appId: number;
  appPath: string;
  chatId: number;
  messageId: number;
  taskId: string;
  testingEnabled: boolean;
  abortSignal: AbortSignal;
}): AgentContext {
  return {
    event: {} as AgentContext["event"],
    appId: params.appId,
    appPath: params.appPath,
    referencedApps: new Map(),
    chatId: params.chatId,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: params.messageId,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    isDyadPro: false,
    todos: [],
    dyadRequestId: params.taskId,
    fileEditTracker: {},
    testingEnabled: params.testingEnabled,
    testRunAttempts: new Map(),
    abortSignal: params.abortSignal,
    enableAppBlueprint: false,
    mutationActivityOwner: {
      appId: params.appId,
      turnId: params.taskId,
      chatId: params.chatId,
      actorRunId: params.taskId,
    },
    onXmlStream: () => {},
    onXmlComplete: () => {},
    appendUserMessage: () => {},
    onUpdateTodos: () => {},
    requireConsent: async ({ toolName }) => {
      const tool = TOOL_DEFINITIONS.find(
        (definition) => definition.name === toolName,
      );
      if (!tool) return false;
      return getToolConsent(tool) === "always";
    },
  };
}

async function executeFactoryTool(params: {
  database: FactoryHostDatabase;
  appId: number;
  toolName: string;
  args: unknown;
  taskId: string;
}): Promise<string> {
  if (!FACTORY_TOOL_NAMES.has(params.toolName)) {
    throw new FactoryHostError(
      "Tool is not available on the factory bridge",
      403,
    );
  }
  const run = params.database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.runId, params.taskId))
    .get();
  if (!run || run.appId !== params.appId) {
    throw new FactoryHostError("Run not found", 404);
  }
  if (!run.gasCityTaskId) {
    throw new FactoryHostError("Run is not an orchestrated task", 409);
  }
  const app = params.database
    .select()
    .from(apps)
    .where(eq(apps.id, params.appId))
    .get();
  if (!app?.factoryHostManaged) {
    throw new FactoryHostError("App is not linked to Gas City", 409);
  }
  const abortController = taskAbortController(params.taskId);
  if (
    run.orchestratorStatus === "cancelled" ||
    abortController.signal.aborted
  ) {
    throw new DyadError(
      "This agent run was cancelled.",
      DyadErrorKind.UserCancelled,
    );
  }
  const ctx = buildFactoryAgentContext({
    appId: params.appId,
    appPath: getDyadAppPath(app.path),
    chatId: run.chatId,
    messageId: run.assistantMessageId ?? 0,
    taskId: params.taskId,
    testingEnabled: app.testingEnabled === true,
    abortSignal: abortController.signal,
  });
  try {
    const output = await invokeRegisteredToolByName({
      toolName: params.toolName,
      args: params.args,
      ctx,
      options: { enableAppBlueprint: false },
    });
    if (output.type !== "text") {
      throw new DyadError(
        "Factory tool returned a non-text result.",
        DyadErrorKind.Internal,
      );
    }
    if (MUTATING_FACTORY_TOOLS.has(params.toolName)) {
      const session = sessions.get(params.taskId);
      if (session) session.updatedFiles = true;
    }
    return output.value;
  } catch (error) {
    if (isDyadError(error) || error instanceof FactoryHostError) throw error;
    if (error instanceof ZodError) {
      throw new DyadError("Invalid tool arguments", DyadErrorKind.Validation);
    }
    throw error;
  }
}

export async function invokeFactoryTool(params: {
  database: FactoryHostDatabase;
  appId: number;
  toolName: string;
  args: unknown;
  taskId: string;
  idempotencyKey: string;
}): Promise<{ result: string }> {
  const cacheKey = `${params.taskId}\0${params.idempotencyKey}`;
  const cached = toolResults.get(cacheKey);
  if (cached) return { result: await cached };
  const pending = executeFactoryTool(params);
  toolResults.set(cacheKey, pending);
  return { result: await pending };
}

export function applyFactoryTurnEvent(
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
  const snapshot = applyFactoryHostEvent(database, input);
  if (!snapshot.appended) return snapshot;
  const session = sessions.get(snapshot.runId);
  if (session) publishSession(database, session);
  if (input.type === "end") {
    finishSession(snapshot.runId, "completed", undefined, true);
  } else if (input.type === "error") {
    finishSession(
      snapshot.runId,
      "errored",
      input.content || "GasCity reported an error.",
    );
  }
  return snapshot;
}

export async function cancelFactoryTask(
  database: FactoryHostDatabase,
  runId: string,
) {
  const snapshot = cancelFactoryHostRun(database, runId);
  taskAbortController(snapshot.runId).abort();
  finishSession(snapshot.runId, "cancelled", undefined, true);
  await notifyFactoryCancel(snapshot.runId);
  return snapshot;
}

function attachSession(params: {
  taskId: string;
  sender: SafeSender;
  chatId: number;
  invocationRef?: ChatStreamInvocationRef;
  streamId?: number;
}): FactorySession {
  let resolveResult: (result: TurnResult) => void = () => {};
  const done = new Promise<TurnResult>((resolve) => {
    resolveResult = resolve;
  });
  const session: FactorySession = {
    sender: params.sender,
    chatId: params.chatId,
    invocationRef: params.invocationRef,
    streamId: params.streamId,
    updatedFiles: false,
    settled: false,
    resolve: resolveResult,
    done,
  };
  sessions.set(params.taskId, session);
  return session;
}

export async function runFactoryOrchestratedTurn(params: {
  database: FactoryHostDatabase;
  sender: SafeSender;
  chatId: number;
  appId: number;
  phase: FactoryPhase;
  prompt: string;
  invocationRef?: ChatStreamInvocationRef;
  streamId?: number;
  abortSignal: AbortSignal;
  notify?: (payload: Record<string, unknown>) => Promise<void>;
  idempotencyKey?: string;
}): Promise<"completed" | "cancelled"> {
  if (params.abortSignal.aborted) return "cancelled";
  const opened = openOrchestratedRun(params.database, {
    appId: params.appId,
    phase: "discovery",
    prompt: params.prompt,
    idempotencyKey: FACTORY_FORMULA,
    formula: FACTORY_FORMULA,
  });
  const taskId = opened.runId;
  if (opened.status === "completed" || opened.status === "cancelled") {
    safeSend(params.sender, "chat:response:end", {
      chatId: params.chatId,
      invocationRef: params.invocationRef,
      streamId: params.streamId,
      updatedFiles: false,
      wasCancelled: opened.status === "cancelled",
    } satisfies ChatStreamEndPayload);
    return opened.status === "cancelled" ? "cancelled" : "completed";
  }
  if (opened.status === "errored") {
    throw new DyadError(
      "GasCity already failed this factory turn.",
      DyadErrorKind.External,
    );
  }
  const session = attachSession({
    taskId,
    sender: params.sender,
    chatId: params.chatId,
    invocationRef: params.invocationRef,
    streamId: params.streamId,
  });
  const onAbort = () => {
    try {
      cancelFactoryHostRun(params.database, taskId);
    } catch {
      // A terminal event may have won the race.
    }
    taskAbortController(taskId).abort();
    finishSession(taskId, "cancelled");
    void notifyFactoryCancel(taskId);
  };
  params.abortSignal.addEventListener("abort", onAbort, { once: true });
  try {
    const payload = {
      type: "sling",
      formula: FACTORY_FORMULA,
      appId: params.appId,
      chatId: params.chatId,
      prompt: params.prompt,
      taskId,
    };
    if (params.notify) await params.notify(payload);
    else await postFactoryOrchestrator(payload);
  } catch (error) {
    params.abortSignal.removeEventListener("abort", onAbort);
    if (!session.settled) {
      markFactoryRunErrored(params.database, taskId);
      finishSession(taskId, "errored");
    }
    throw error;
  }
  const result = await session.done;
  params.abortSignal.removeEventListener("abort", onAbort);
  if (result.outcome === "errored") {
    throw new DyadError(
      result.errorMessage || "GasCity reported an error.",
      DyadErrorKind.External,
    );
  }
  return result.outcome === "cancelled" ? "cancelled" : "completed";
}

export async function submitFactoryGateVerdict(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
) {
  const state = readFactoryState(database, appId);
  const step = formulaStep(state.currentStepId);
  if (!state.formula || !state.workflowTaskId || !step) {
    throw new FactoryHostError("No formula run is waiting for a verdict", 409);
  }
  if (!state.gateWaiting || step.phase !== phase) {
    throw new FactoryHostError("This phase gate is not open", 409);
  }
  await postFactoryOrchestrator({
    type: "verdict",
    taskId: state.workflowTaskId,
    stepId: step.id,
    verdict: "approve",
  });
  return readFactoryState(database, appId);
}
