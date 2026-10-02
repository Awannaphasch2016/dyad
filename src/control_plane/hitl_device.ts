import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hitlAnswers, hitlQuestions } from "@/db/schema";
import type { FactoryHostDatabase } from "@/main/factory_host_service";
import { FactoryHostError } from "@/main/factory_host_service";
import {
  assertGateRole,
  decideAnswer,
  presentQuestion,
  type HitlCaller,
  type HitlQuestionRecord,
  type HitlQuestionView,
} from "./hitl";

type DeviceDb = FactoryHostDatabase;

function rowToRecord(
  row: typeof hitlQuestions.$inferSelect,
): HitlQuestionRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    appId: String(row.appId),
    phase: row.phase,
    runId: row.runId,
    stepId: row.stepId,
    targetRoleId: row.targetRoleId as HitlQuestionRecord["targetRoleId"],
    visibility: "role",
    status: row.status,
    body: row.body,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    beadId: row.beadId,
    answeredByUserId: row.answeredByUserId,
    answeredByName: row.answeredByName,
    answeredAt: row.answeredAt,
  };
}

export function listHitlQuestions(
  database: DeviceDb,
  input: { orgId: string; appId: number; phase: string; caller: HitlCaller },
): HitlQuestionView[] {
  const rows = database
    .select()
    .from(hitlQuestions)
    .where(
      and(
        eq(hitlQuestions.orgId, input.orgId),
        eq(hitlQuestions.appId, input.appId),
        eq(hitlQuestions.phase, input.phase),
      ),
    )
    .all();
  return rows.flatMap((row) => {
    const view = presentQuestion(rowToRecord(row), input.caller);
    return view ? [view] : [];
  });
}

export function getHitlQuestion(
  database: DeviceDb,
  input: { questionId: string; caller: HitlCaller },
): HitlQuestionView {
  const row = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.id, input.questionId))
    .get();
  if (!row) throw new FactoryHostError("Not found", 404);
  const view = presentQuestion(rowToRecord(row), input.caller);
  if (!view) throw new FactoryHostError("Not found", 404);
  return view;
}

export interface CreateHitlQuestionInput {
  orgId: string;
  appId: number;
  phase: string;
  chatId: number | null;
  runId: string;
  stepId: string;
  targetRoleId: string;
  body: string;
  idempotencyKey: string;
  gateBeadId: string | null;
}

export function createHitlQuestion(
  database: DeviceDb,
  input: CreateHitlQuestionInput,
): { question: HitlQuestionRecord; created: boolean } {
  let targetRoleId: HitlQuestionRecord["targetRoleId"];
  try {
    targetRoleId = assertGateRole(input.stepId, input.targetRoleId);
  } catch (error) {
    throw new FactoryHostError(
      error instanceof Error ? error.message : "Invalid gate",
      400,
    );
  }
  const existing = database
    .select()
    .from(hitlQuestions)
    .where(
      and(
        eq(hitlQuestions.orgId, input.orgId),
        eq(hitlQuestions.idempotencyKey, input.idempotencyKey),
      ),
    )
    .get();
  if (existing) return { question: rowToRecord(existing), created: false };
  const id = randomUUID();
  database
    .insert(hitlQuestions)
    .values({
      id,
      orgId: input.orgId,
      appId: input.appId,
      phase: input.phase,
      chatId: input.chatId,
      runId: input.runId,
      stepId: input.stepId,
      targetRoleId,
      visibility: "role",
      status: "open",
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      beadId: input.gateBeadId,
    })
    .run();
  const stored = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.id, id))
    .get();
  if (!stored) throw new FactoryHostError("Question was not stored", 500);
  return { question: rowToRecord(stored), created: true };
}

export async function answerHitlQuestion(
  database: DeviceDb,
  input: { questionId: string; caller: HitlCaller; body: string },
): Promise<{ view: HitlQuestionView; resolved: boolean }> {
  const row = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.id, input.questionId))
    .get();
  if (!row) throw new FactoryHostError("Not found", 404);
  const record = rowToRecord(row);
  const decision = decideAnswer(record, input.caller);
  if (decision.kind === "not-found") {
    throw new FactoryHostError("Not found", 404);
  }
  if (decision.kind === "forbidden") {
    throw new FactoryHostError("Your role can't answer this question.", 403);
  }
  if (decision.kind === "already-answered") {
    const view = presentQuestion(record, input.caller);
    if (!view) throw new FactoryHostError("Not found", 404);
    return { view, resolved: false };
  }
  const actor = input.caller.displayName || input.caller.userId;
  const answeredAt = new Date();
  database
    .insert(hitlAnswers)
    .values({
      id: randomUUID(),
      questionId: record.id,
      userId: input.caller.userId,
      body: input.body,
      createdAt: answeredAt,
    })
    .run();
  database
    .update(hitlQuestions)
    .set({
      status: "answered",
      answeredByUserId: input.caller.userId,
      answeredByName: actor,
      answeredAt,
    })
    .where(eq(hitlQuestions.id, record.id))
    .run();
  const updated = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.id, record.id))
    .get();
  if (!updated) throw new FactoryHostError("Question was not stored", 500);
  const view = presentQuestion(rowToRecord(updated), input.caller);
  if (!view) throw new FactoryHostError("Not found", 404);
  await syncRemote(rowToRecord(updated), {
    userId: input.caller.userId,
    body: input.body,
    createdAt: answeredAt,
  });
  return { view, resolved: false };
}

export async function syncRemote(
  question: HitlQuestionRecord,
  answer?: { userId: string; body: string; createdAt: Date },
): Promise<void> {
  const { controlPlaneConfigured, getControlPlaneDb } = await import("./db");
  if (!controlPlaneConfigured()) return;
  try {
    const plane = await getControlPlaneDb();
    if (!plane) return;
    const { mirrorAnswer, mirrorQuestion } = await import("./hitl_store");
    await mirrorQuestion(plane, question);
    if (answer) {
      await mirrorAnswer(plane, { questionId: question.id, ...answer });
    }
  } catch {
    return;
  }
}
