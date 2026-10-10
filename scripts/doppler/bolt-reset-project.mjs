// Put the shared walkthrough project back to Discovery, or check that the
// Project Manager run left it in Implementation. Roles, memberships, the app,
// and the chat row stay. Prints counts and phases, never a secret.

import { pathToFileURL } from "node:url";
import { redact } from "./bolt-project.mjs";
import {
  WALKTHROUGH_APP_ID,
  WALKTHROUGH_CHAT_ID,
  safe,
} from "./bolt-sign-in.mjs";
import { IMPLEMENTATION_QUESTION_ID } from "./bolt-workflow.mjs";

export const PROMPT = "A single page that lists the North Pier lunch menu.";

export function neonRows(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows.map((row) => {
    if (!Array.isArray(row)) return row ?? {};
    const record = {};
    fields.forEach((field, index) => {
      record[field.name] = row[index];
    });
    return record;
  });
}

export function countsQuery() {
  return {
    query: `select
      (select phase from wewebplus.project_state where app_id = $1) as phase,
      (select count(*) from wewebplus.messages where chat_id = $2) as messages,
      (select count(*) from wewebplus.questions where id = $3) as questions,
      (select count(*) from wewebplus.answers where question_id = $3) as answers`,
    params: [
      WALKTHROUGH_APP_ID,
      WALKTHROUGH_CHAT_ID,
      IMPLEMENTATION_QUESTION_ID,
    ],
  };
}

export function resetStatements() {
  return [
    {
      name: "phase",
      query:
        "update wewebplus.project_state set phase = 'discovery', document_html = null, delivered_at = null, busy = false where app_id = $1 returning phase",
      params: [WALKTHROUGH_APP_ID],
    },
    {
      name: "messages",
      query: "delete from wewebplus.messages where chat_id = $1",
      params: [WALKTHROUGH_CHAT_ID],
    },
    {
      name: "answers",
      query: "delete from wewebplus.answers where question_id = $1",
      params: [IMPLEMENTATION_QUESTION_ID],
    },
    {
      name: "questions",
      query: "delete from wewebplus.questions where id = $1",
      params: [IMPLEMENTATION_QUESTION_ID],
    },
  ];
}

export function countRecord(row) {
  return {
    phase: row?.phase == null ? null : String(row.phase),
    messages: Number(row?.messages ?? 0),
    questions: Number(row?.questions ?? 0),
    answers: Number(row?.answers ?? 0),
  };
}

export function resetReport(before, after) {
  return [
    `previous_phase=${before.phase ?? "absent"}`,
    `phase=${after.phase ?? "absent"}`,
    `removed_messages=${before.messages}`,
    `removed_questions=${before.questions}`,
    `removed_answers=${before.answers}`,
    `messages=${after.messages}`,
    `questions=${after.questions}`,
    `answers=${after.answers}`,
  ];
}

export function checkQuery() {
  return {
    query: `select
      (select phase from wewebplus.project_state where app_id = $1) as phase,
      (select document_html is not null from wewebplus.project_state where app_id = $1) as has_document,
      (select delivered_at is not null from wewebplus.project_state where app_id = $1) as has_delivered,
      (select count(*) from wewebplus.messages where chat_id = $2 and role = 'user' and position($4 in content) > 0) as user_messages,
      (select count(*) from wewebplus.messages where chat_id = $2 and role = 'assistant') as assistant_messages,
      (select status from wewebplus.questions where id = $3) as question_status`,
    params: [
      WALKTHROUGH_APP_ID,
      WALKTHROUGH_CHAT_ID,
      IMPLEMENTATION_QUESTION_ID,
      PROMPT,
    ],
  };
}

function truthy(value) {
  return value === true || value === "t" || value === "true";
}

export function deliveredQuery() {
  const statement = checkQuery();
  return {
    query: `${statement.query},
      (select count(*) from wewebplus.answers where question_id = $3) as answers`,
    params: statement.params,
  };
}

export function deliveredProblems(row) {
  const problems = [];
  const phase = row?.phase == null ? "absent" : String(row.phase);
  if (phase !== "delivered") problems.push(`phase=${phase}`);
  if (Number(row?.user_messages ?? 0) < 1) problems.push("user_messages=0");
  if (Number(row?.assistant_messages ?? 0) < 1) {
    problems.push("assistant_messages=0");
  }
  const question =
    row?.question_status == null ? "absent" : String(row.question_status);
  if (question !== "answered") problems.push(`question=${question}`);
  const answers = Number(row?.answers ?? 0);
  if (answers !== 1) problems.push(`answers=${answers}`);
  if (!truthy(row?.has_document)) problems.push("document_html=absent");
  if (!truthy(row?.has_delivered)) problems.push("delivered_at=absent");
  return problems;
}

export function implementationProblems(row) {
  const problems = [];
  const phase = row?.phase == null ? "absent" : String(row.phase);
  if (phase !== "implementation") problems.push(`phase=${phase}`);
  if (Number(row?.user_messages ?? 0) < 1) problems.push("user_messages=0");
  if (Number(row?.assistant_messages ?? 0) < 1) {
    problems.push("assistant_messages=0");
  }
  const question =
    row?.question_status == null ? "absent" : String(row.question_status);
  if (question !== "open") problems.push(`question=${question}`);
  if (truthy(row?.has_document)) problems.push("document_html=present");
  if (truthy(row?.has_delivered)) problems.push("delivered_at=present");
  return problems;
}

async function neonRowsQuery(databaseUrl, statement) {
  const endpoint = new URL(databaseUrl);
  const response = await fetch(`https://${endpoint.host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": databaseUrl,
    },
    body: JSON.stringify({
      query: statement.query,
      params: statement.params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Question store ${response.status} ${safe(text)}`);
  }
  return neonRows(text ? JSON.parse(text) : {});
}

export async function resetWalkthroughProject() {
  const databaseUrl = (process.env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new Error("Question store is unavailable.");
  const before = countRecord(
    (await neonRowsQuery(databaseUrl, countsQuery()))[0],
  );
  for (const statement of resetStatements()) {
    await neonRowsQuery(databaseUrl, statement);
  }
  const after = countRecord(
    (await neonRowsQuery(databaseUrl, countsQuery()))[0],
  );
  for (const line of resetReport(before, after)) console.log(line);
  if (
    after.phase !== "discovery" ||
    after.messages !== 0 ||
    after.questions !== 0
  ) {
    throw new Error("The walkthrough project did not return to Discovery");
  }
}

async function requireDatabase() {
  const databaseUrl = (process.env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new Error("Question store is unavailable.");
  return databaseUrl;
}

function reportRow(row) {
  console.log(
    `phase=${row.phase ?? "absent"} user_messages=${Number(row.user_messages ?? 0)} assistant_messages=${Number(row.assistant_messages ?? 0)} question=${row.question_status ?? "absent"} answers=${Number(row.answers ?? 0)}`,
  );
}

export async function checkWalkthroughProject() {
  const row =
    (await neonRowsQuery(await requireDatabase(), checkQuery()))[0] ?? {};
  const problems = implementationProblems(row);
  reportRow(row);
  if (problems.length > 0) {
    throw new Error(`Walkthrough check failed: ${problems.join(" ")}`);
  }
  console.log("walkthrough_check=implementation");
}

export async function checkDeliveredProject() {
  const row =
    (await neonRowsQuery(await requireDatabase(), deliveredQuery()))[0] ?? {};
  const problems = deliveredProblems(row);
  reportRow(row);
  if (problems.length > 0) {
    throw new Error(`Walkthrough check failed: ${problems.join(" ")}`);
  }
  console.log("walkthrough_check=delivered");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const run =
    process.argv[2] === "check"
      ? checkWalkthroughProject
      : process.argv[2] === "check-delivered"
        ? checkDeliveredProject
        : resetWalkthroughProject;
  run().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
