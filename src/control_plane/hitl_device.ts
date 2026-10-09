import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { factoryHostRuns, hitlAnswers, hitlQuestions } from "@/db/schema";
import { FACTORY_PHASES, type FactoryPhase } from "@/lib/factoryPhase";
import type { FactoryHostDatabase } from "@/main/factory_host_service";
import {
  FactoryHostError,
  startFactoryRun,
  type FactoryRunDispatch,
} from "@/main/factory_host_service";
import {
  decideAnswer,
  presentQuestion,
  roleForQuestionStep,
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
    targetRoleId = roleForQuestionStep(input.stepId, input.targetRoleId);
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

function isFactoryPhase(value: string): value is FactoryPhase {
  return (FACTORY_PHASES as readonly string[]).includes(value);
}

export async function answerHitlQuestion(
  database: DeviceDb,
  input: {
    questionId: string;
    caller: HitlCaller;
    body: string;
    dispatch?: FactoryRunDispatch;
  },
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
  const resolved = await resumeLocalRun(database, {
    appId: updated.appId,
    phase: updated.phase,
    runId: updated.runId,
    questionId: updated.id,
    questionBody: updated.body,
    answerBody: input.body,
    dispatch: input.dispatch,
  });
  return { view, resolved };
}

/**
 * A question filed against a local factory run starts one follow-up run.
 * An answer that is already stored returns before this runs.
 * Questions that belong to a GasCity bead have no local run and stay
 * unresolved here; the bead worker still closes those.
 */
async function resumeLocalRun(
  database: DeviceDb,
  input: {
    appId: number;
    phase: string;
    runId: string;
    questionId: string;
    questionBody: string;
    answerBody: string;
    dispatch?: FactoryRunDispatch;
  },
): Promise<boolean> {
  if (!isFactoryPhase(input.phase)) return false;
  const localRun = database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.runId, input.runId))
    .get();
  if (!localRun || localRun.appId !== input.appId) return false;
  const idempotencyKey = `${input.questionId}:resume`;
  try {
    await startFactoryRun(
      database,
      {
        appId: input.appId,
        phase: input.phase,
        prompt: `${input.questionBody}\n\n${input.answerBody}`,
        idempotencyKey,
      },
      input.dispatch,
      { requireLink: false },
    );
  } catch {
    return false;
  }
  const resume = database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.idempotencyKey, idempotencyKey))
    .get();
  return resume?.acceptance === "accepted";
}

/** Start follow-ups for answers that were stored and then lost the dispatch. An accepted follow-up is left alone. */
export async function resumeAnsweredFactoryQuestions(
  database: DeviceDb,
  dispatch?: FactoryRunDispatch,
): Promise<number> {
  const answered = database
    .select()
    .from(hitlQuestions)
    .where(eq(hitlQuestions.status, "answered"))
    .all();
  let started = 0;
  for (const question of answered) {
    const existing = database
      .select()
      .from(factoryHostRuns)
      .where(eq(factoryHostRuns.idempotencyKey, `${question.id}:resume`))
      .get();
    if (existing?.acceptance === "accepted") continue;
    const answer = database
      .select()
      .from(hitlAnswers)
      .where(eq(hitlAnswers.questionId, question.id))
      .get();
    if (!answer) continue;
    const ok = await resumeLocalRun(database, {
      appId: question.appId,
      phase: question.phase,
      runId: question.runId,
      questionId: question.id,
      questionBody: question.body,
      answerBody: answer.body,
      dispatch,
    });
    if (ok) started += 1;
  }
  return started;
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
