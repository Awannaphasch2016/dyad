import { and, eq, like, or } from "drizzle-orm";
import {
  apps,
  factoryHostMessages,
  factoryHostRuns,
  hitlQuestions,
  messages,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  FACTORY_PHASES,
  type FactoryPhase,
  continuePrefill,
  factoryPhaseKickoff,
  latestFactoryPhaseSummary,
} from "@/lib/factoryPhase";
import { classifyCursorFactoryStop } from "@/lib/cursorFactoryStop";
import { factoryPhaseSystemPrompt } from "@/prompts/factory_phase_prompt";
import type { CursorFollowUpSender } from "@/control_plane/hitl_device";
import { db } from "@/db";
import { openFactoryRequestForRun } from "@/main/factory_host_request";
import {
  CURSOR_RUN_PREFIX,
  postFactoryHostMessage,
  recordCursorFactoryRun,
  resolveFactoryPhaseChats,
  type FactoryHostDatabase,
} from "@/main/factory_host_service";
import {
  cursorFactoryClientFromEnv,
  type CursorFactoryClient,
} from "@/main/cursor_factory_client";

/** The real phase prompt plus that phase's kickoff. No scripted questions. */
export function cursorPhasePrompt(
  phase: FactoryPhase,
  previousSummary: string | null,
): string {
  const kickoff =
    phase === "implementation"
      ? (continuePrefill(phase, previousSummary) ??
        "Build the one-page site from what I approved in Discovery.")
      : (factoryPhaseKickoff(phase, previousSummary) ?? "");
  return `${factoryPhaseSystemPrompt(phase)}\n\n${kickoff}`.trim();
}

function isPhase(value: string): value is FactoryPhase {
  return (FACTORY_PHASES as readonly string[]).includes(value);
}

function previousSummary(
  database: FactoryHostDatabase,
  appId: number,
  phase: FactoryPhase,
): string | null {
  const previous = FACTORY_PHASES[FACTORY_PHASES.indexOf(phase) - 1];
  if (!previous) return null;
  const chatId = resolveFactoryPhaseChats(database, appId)[previous];
  const rows = database
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .all();
  return latestFactoryPhaseSummary(rows, previous);
}

function cursorRunSettled(
  database: FactoryHostDatabase,
  runId: string,
): boolean {
  const question = database
    .select({ id: hitlQuestions.id })
    .from(hitlQuestions)
    .where(eq(hitlQuestions.runId, runId))
    .get();
  if (question) return true;
  const marker = database
    .select({ id: factoryHostMessages.id })
    .from(factoryHostMessages)
    .where(
      or(
        eq(factoryHostMessages.idempotencyKey, `${runId}:summary`),
        eq(factoryHostMessages.idempotencyKey, `${runId}:terminal`),
      ),
    )
    .get();
  return marker != null;
}

export function cursorFollowUpForDesktop(
  env: NodeJS.ProcessEnv = process.env,
): CursorFollowUpSender | undefined {
  const client = cursorFactoryClientFromEnv(env);
  if (!client) return undefined;
  return (input) => client.followUp(input.cursorAgentId, input.prompt);
}

/**
 * Start the phase on a Cursor agent when this process has the key.
 * An unsettled run for the phase is left as-is. No key means the local chat starts.
 */
export async function startCursorPhase(
  database: FactoryHostDatabase,
  client: CursorFactoryClient | null,
  input: { appId: number; phase: FactoryPhase },
): Promise<{ started: boolean }> {
  if (!client) return { started: false };
  const open = database
    .select()
    .from(factoryHostRuns)
    .where(
      and(
        eq(factoryHostRuns.appId, input.appId),
        eq(factoryHostRuns.phase, input.phase),
        like(factoryHostRuns.runId, `${CURSOR_RUN_PREFIX}%`),
      ),
    )
    .all()
    .find((run) => !cursorRunSettled(database, run.runId));
  if (open) return { started: true };

  const app = database
    .select()
    .from(apps)
    .where(eq(apps.id, input.appId))
    .get();
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  const prompt = cursorPhasePrompt(
    input.phase,
    previousSummary(database, input.appId, input.phase),
  );
  const repository =
    app.githubOrg && app.githubRepo
      ? `https://github.com/${app.githubOrg}/${app.githubRepo}`
      : null;
  const created = await client.createAgent({
    name: `dyad ${input.phase}`,
    prompt,
    repository,
    ref: app.githubBranch,
  });
  recordCursorFactoryRun(database, {
    appId: input.appId,
    phase: input.phase,
    cursorAgentId: created.agentId,
    cursorRunId: created.cursorRunId,
    prompt,
    idempotencyKey: `cursor-phase:${input.phase}:${created.cursorRunId}`,
  });
  return { started: true };
}

export type CursorSettlement = "pending" | "question" | "summary" | "terminal";

/** Read one finished Cursor run into the phase chat or the question list. */
export async function settleCursorFactoryRun(
  database: FactoryHostDatabase,
  client: CursorFactoryClient,
  run: typeof factoryHostRuns.$inferSelect,
): Promise<CursorSettlement> {
  if (!run.cursorAgentId || !run.runId.startsWith(CURSOR_RUN_PREFIX)) {
    return "terminal";
  }
  if (cursorRunSettled(database, run.runId)) return "terminal";
  if (!isPhase(run.phase)) return "terminal";
  const snapshot = await client.getRun(
    run.cursorAgentId,
    run.runId.slice(CURSOR_RUN_PREFIX.length),
  );
  const stop = classifyCursorFactoryStop({
    cursorStatus: snapshot.status,
    finalMessage: snapshot.message,
    phase: run.phase,
  });
  if (!stop) return "pending";
  if (stop === "human-required") {
    const opened = openFactoryRequestForRun(
      database,
      run.runId,
      snapshot.message ?? "",
    );
    return opened?.questionId ? "question" : "pending";
  }
  if (stop === "ready-for-approval" && snapshot.message) {
    postFactoryHostMessage(database, {
      appId: run.appId,
      phase: run.phase,
      role: "assistant",
      content: snapshot.message,
      idempotencyKey: `${run.runId}:summary`,
    });
    return "summary";
  }
  postFactoryHostMessage(database, {
    appId: run.appId,
    phase: run.phase,
    role: "system",
    content: `Cursor run ${snapshot.status.toLowerCase() || "stopped"}.`,
    idempotencyKey: `${run.runId}:terminal`,
  });
  return "terminal";
}

export async function pollCursorFactoryRuns(
  database: FactoryHostDatabase,
  client: CursorFactoryClient,
): Promise<void> {
  const runs = database
    .select()
    .from(factoryHostRuns)
    .where(like(factoryHostRuns.runId, `${CURSOR_RUN_PREFIX}%`))
    .all();
  for (const run of runs) {
    if (cursorRunSettled(database, run.runId)) continue;
    try {
      await settleCursorFactoryRun(database, client, run);
    } catch (error) {
      console.error(
        "[cursor-factory] poll failed",
        error instanceof Error ? error.message : "poll failed",
      );
    }
  }
}

let pollTimer: NodeJS.Timeout | null = null;

export function startCursorFactoryPoller(
  database: FactoryHostDatabase = db,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (pollTimer) return;
  const client = cursorFactoryClientFromEnv(env);
  if (!client) return;
  const tick = () => {
    void pollCursorFactoryRuns(database, client);
  };
  pollTimer = setInterval(tick, 10_000);
  pollTimer.unref?.();
  tick();
}
