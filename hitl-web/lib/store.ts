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

export async function listQuestions(
  sql: Sql,
  caller: HitlCaller,
): Promise<HitlQuestionView[]> {
  const rows = await sql<QuestionRow[]>`
    select id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
           status, body, idempotency_key, created_at, bead_id,
           answered_by_user_id, answered_by_name, answered_at
    from wewebplus.questions
    where org_id = ${caller.orgId}
    order by created_at asc
    limit 100
  `;
  return rows.flatMap((row) => {
    const record = toRecord(row);
    if (!record) return [];
    const view = presentQuestion(record, caller);
    return view ? [view] : [];
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
