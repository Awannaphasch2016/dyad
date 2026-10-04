import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  decideAnswer,
  isAdminRoleId,
  presentQuestion,
  type HitlCaller,
  type HitlQuestionRecord,
  type HitlQuestionView,
} from "./hitl";
import type { Membership } from "./membership";

type QuestionRow = {
  id: string;
  org_id: string;
  app_id: string;
  phase: string;
  run_id: string;
  step_id: string;
  target_role_id: string;
  visibility: string;
  status: string;
  body: string;
  idempotency_key: string;
  created_at: Date;
  bead_id: string | null;
  answered_by_user_id: string | null;
  answered_by_name: string | null;
  answered_at: Date | null;
  runtime_run_id: string | null;
};

function toRecord(row: QuestionRow): HitlQuestionRecord | null {
  if (!isAdminRoleId(row.target_role_id)) return null;
  if (row.status !== "open" && row.status !== "answered") return null;
  if (row.visibility !== "role") return null;
  return {
    id: row.id,
    orgId: row.org_id,
    appId: row.app_id,
    phase: row.phase,
    runId: row.run_id,
    stepId: row.step_id,
    targetRoleId: row.target_role_id,
    visibility: "role",
    status: row.status,
    body: row.body,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    beadId: row.bead_id,
    answeredByUserId: row.answered_by_user_id,
    answeredByName: row.answered_by_name,
    answeredAt: row.answered_at ? new Date(row.answered_at) : null,
  };
}

export type ListedQuestion = HitlQuestionView & {
  runtimeRunId: string | null;
};

function withRuntime(
  view: HitlQuestionView,
  runtimeRunId: string | null,
): ListedQuestion {
  return { ...view, runtimeRunId };
}

export async function readMemberships(
  sql: Sql,
  userId: string,
): Promise<Membership[]> {
  const rows = await sql<
    { org_id: string; role_id: string }[]
  >`select org_id, role_id from wewebplus.memberships where user_id = ${userId}`;
  return rows.map((row) => ({
    orgId: row.org_id,
    roleId: isAdminRoleId(row.role_id) ? row.role_id : null,
  }));
}

async function selectQuestionRows(
  sql: Sql,
  caller: HitlCaller,
  questionId?: string,
): Promise<QuestionRow[]> {
  try {
    if (questionId) {
      return await sql<QuestionRow[]>`
        select q.id, q.org_id, q.app_id, q.phase, q.run_id, q.step_id, q.target_role_id,
               q.visibility, q.status, q.body, q.idempotency_key, q.created_at, q.bead_id,
               q.answered_by_user_id, q.answered_by_name, q.answered_at,
               a.runtime_run_id
        from wewebplus.questions q
        left join wewebplus.answers a on a.question_id = q.id
        where q.id = ${questionId}
      `;
    }
    return await sql<QuestionRow[]>`
      select q.id, q.org_id, q.app_id, q.phase, q.run_id, q.step_id, q.target_role_id,
             q.visibility, q.status, q.body, q.idempotency_key, q.created_at, q.bead_id,
             q.answered_by_user_id, q.answered_by_name, q.answered_at,
             a.runtime_run_id
      from wewebplus.questions q
      left join wewebplus.answers a on a.question_id = q.id
      where q.org_id = ${caller.orgId}
      order by q.created_at asc
      limit 100
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("runtime_run_id")) throw error;
    const rows = await sql<Omit<QuestionRow, "runtime_run_id">[]>`
      select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
             status, body, idempotency_key, created_at, bead_id,
             answered_by_user_id, answered_by_name, answered_at
      from wewebplus.questions
      where ${questionId ? sql`id = ${questionId}` : sql`org_id = ${caller.orgId}`}
      order by created_at asc
      limit 100
    `;
    return rows.map((row) => ({ ...row, runtime_run_id: null }));
  }
}

export async function listQuestions(
  sql: Sql,
  caller: HitlCaller,
): Promise<ListedQuestion[]> {
  const rows = await selectQuestionRows(sql, caller);
  return rows.flatMap((row) => {
    const record = toRecord(row);
    if (!record) return [];
    const view = presentQuestion(record, caller);
    return view ? [withRuntime(view, row.runtime_run_id)] : [];
  });
}

export type AnswerResult =
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "view"; view: HitlQuestionView };

export async function answerQuestion(
  sql: Sql,
  caller: HitlCaller,
  questionId: string,
  body: string,
): Promise<AnswerResult> {
  return sql.begin(async (tx) => {
    const rows = await tx<QuestionRow[]>`
      select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
             status, body, idempotency_key, created_at, bead_id,
             answered_by_user_id, answered_by_name, answered_at
      from wewebplus.questions
      where id = ${questionId}
      for update
    `;
    const record = rows[0] ? toRecord(rows[0]) : null;
    if (!record) return { kind: "not-found" };
    const decision = decideAnswer(record, caller);
    if (decision.kind === "not-found") return { kind: "not-found" };
    if (decision.kind === "forbidden") return { kind: "forbidden" };
    if (decision.kind === "already-answered") {
      const view = presentQuestion(record, caller);
      if (!view) return { kind: "not-found" };
      return { kind: "view", view };
    }
    const answeredAt = new Date();
    await tx`
      insert into wewebplus.answers (id, question_id, user_id, body, created_at)
      values (${randomUUID()}, ${record.id}, ${caller.userId}, ${body}, ${answeredAt})
      on conflict (question_id) do nothing
    `;
    await tx`
      update wewebplus.questions
      set status = 'answered',
          answered_by_user_id = ${caller.userId},
          answered_by_name = ${caller.displayName},
          answered_at = ${answeredAt}
      where id = ${record.id}
        and org_id = ${caller.orgId}
        and status = 'open'
    `;
    const updated = await tx<QuestionRow[]>`
      select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
             status, body, idempotency_key, created_at, bead_id,
             answered_by_user_id, answered_by_name, answered_at
      from wewebplus.questions
      where id = ${record.id}
    `;
    const next = updated[0] ? toRecord(updated[0]) : null;
    const view = next ? presentQuestion(next, caller) : null;
    if (!view) return { kind: "not-found" };
    return { kind: "view", view };
  });
}
