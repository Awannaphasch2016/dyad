import { and, eq, or } from "drizzle-orm";
import { createHitlQuestion } from "@/control_plane/hitl_device";
import { apps, factoryHostRuns, hitlQuestions } from "@/db/schema";
import type { FactoryPhase } from "@/lib/factoryPhase";
import { extractFactoryRequest } from "@/lib/factoryRequest";
import {
  classifyFactoryStop,
  type FactoryStopClass,
  type FactoryStopStatus,
} from "@/lib/factoryStop";
import {
  readFactoryRun,
  type FactoryHostDatabase,
} from "@/main/factory_host_service";

export interface OpenedFactoryRequest {
  stop: FactoryStopClass;
  questionId: string | null;
}

/**
 * A finished factory run that asked for a role becomes one question.
 * The same run opened twice keeps that question. A summary does not.
 * `finalMessage` is the assistant text when the caller already has it;
 * otherwise the completed run's stored reply is used.
 */
export function openFactoryRequestForRun(
  database: FactoryHostDatabase,
  runOrIntentId: string,
  finalMessage?: string,
): OpenedFactoryRequest | null {
  const run = database
    .select()
    .from(factoryHostRuns)
    .where(
      or(
        eq(factoryHostRuns.runId, runOrIntentId),
        eq(factoryHostRuns.intentId, runOrIntentId),
      ),
    )
    .get();
  if (!run) return null;

  let content = finalMessage;
  let status: FactoryStopStatus = "completed";
  if (content === undefined) {
    const view = readFactoryRun(database, run.runId);
    if (
      view.status !== "completed" &&
      view.status !== "errored" &&
      view.status !== "cancelled" &&
      view.status !== "rejected"
    ) {
      return null;
    }
    status = view.status;
    content = view.finalResult?.content ?? "";
  }

  const stop = classifyFactoryStop({
    status,
    finalMessage: content,
    phase: run.phase as FactoryPhase,
  });
  if (stop !== "human-required") return { stop, questionId: null };

  const request = extractFactoryRequest(content);
  if (!request) return { stop, questionId: null };

  const app = database.select().from(apps).where(eq(apps.id, run.appId)).get();
  if (!app || app.ownerType !== "org" || !app.ownerId) {
    return { stop, questionId: null };
  }

  const idempotencyKey = `${run.runId}:request`;
  const existing = database
    .select()
    .from(hitlQuestions)
    .where(
      and(
        eq(hitlQuestions.orgId, app.ownerId),
        eq(hitlQuestions.idempotencyKey, idempotencyKey),
      ),
    )
    .get();
  if (existing) return { stop, questionId: existing.id };

  const created = createHitlQuestion(database, {
    orgId: app.ownerId,
    appId: run.appId,
    phase: run.phase,
    chatId: run.chatId,
    runId: run.runId,
    stepId: "question",
    targetRoleId: request.role,
    body: request.body,
    idempotencyKey,
    gateBeadId: null,
  });
  return { stop, questionId: created.question.id };
}
