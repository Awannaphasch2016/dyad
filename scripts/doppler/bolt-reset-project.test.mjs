import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IMPLEMENTATION_QUESTION_ID } from "./bolt-workflow.mjs";
import { WALKTHROUGH_APP_ID, WALKTHROUGH_CHAT_ID } from "./bolt-sign-in.mjs";
import {
  P3_IDEMPOTENCY_KEY,
  P3_QUESTION_BODY,
  PROMPT,
  checkQuery,
  countRecord,
  countsQuery,
  implementationProblems,
  neonRows,
  resetReport,
  resetStatements,
} from "./bolt-reset-project.mjs";

test("reset keeps the app and chat and clears the run", () => {
  const statements = resetStatements();
  assert.deepEqual(
    statements.map((statement) => statement.name),
    ["phase", "messages", "answers", "questions", "p3-answers", "p3-questions"],
  );
  assert.match(statements[0].query, /phase = 'discovery'/);
  assert.match(statements[0].query, /document_html = null/);
  assert.match(statements[0].query, /delivered_at = null/);
  assert.match(statements[0].query, /busy = false/);
  assert.deepEqual(statements[0].params, [WALKTHROUGH_APP_ID]);
  assert.deepEqual(statements[1].params, [WALKTHROUGH_CHAT_ID]);
  assert.deepEqual(statements[2].params, [IMPLEMENTATION_QUESTION_ID]);
  assert.deepEqual(statements[3].params, [IMPLEMENTATION_QUESTION_ID]);
  assert.deepEqual(statements[4].params, [P3_IDEMPOTENCY_KEY]);
  assert.deepEqual(statements[5].params, [P3_IDEMPOTENCY_KEY]);
  assert.match(statements[4].query, /wewebplus\.answers/);
  assert.match(statements[5].query, /idempotency_key/);
  assert.ok(
    statements.every(
      (statement) => !/roles|memberships|apps|chats/.test(statement.query),
    ),
  );
});

test("counts read phase and row totals", () => {
  const statement = countsQuery();
  assert.deepEqual(statement.params, [
    WALKTHROUGH_APP_ID,
    WALKTHROUGH_CHAT_ID,
    IMPLEMENTATION_QUESTION_ID,
  ]);
  assert.deepEqual(
    countRecord({
      phase: "delivered",
      messages: "4",
      questions: "1",
      answers: "1",
    }),
    { phase: "delivered", messages: 4, questions: 1, answers: 1 },
  );
  assert.equal(countRecord(undefined).phase, null);
});

test("the reset report names what was removed", () => {
  assert.deepEqual(
    resetReport(
      { phase: "delivered", messages: 4, questions: 1, answers: 1 },
      { phase: "discovery", messages: 0, questions: 0, answers: 0 },
    ),
    [
      "previous_phase=delivered",
      "phase=discovery",
      "removed_messages=4",
      "removed_questions=1",
      "removed_answers=1",
      "messages=0",
      "questions=0",
      "answers=0",
    ],
  );
});

test("neon rows accept object rows and field-aligned arrays", () => {
  assert.deepEqual(neonRows({ rows: [{ phase: "discovery" }] }), [
    { phase: "discovery" },
  ]);
  assert.deepEqual(
    neonRows({
      fields: [{ name: "phase" }, { name: "messages" }],
      rows: [["implementation", "2"]],
    }),
    [{ phase: "implementation", messages: "2" }],
  );
  assert.deepEqual(neonRows({}), []);
});

test("the browser prompt is the sentence the database check looks for", () => {
  const source = readFileSync(
    new URL(
      "../../e2e-walkthrough/tests/pm-discovery.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    new RegExp(PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("the role visibility check posts the question reset removes", () => {
  const source = readFileSync(
    new URL(
      "../../e2e-walkthrough/tests/zz-p3-role-visibility.spec.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(source, new RegExp(escape(P3_IDEMPOTENCY_KEY)));
  assert.match(source, new RegExp(escape(P3_QUESTION_BODY)));
  assert.match(source, /stepId: "plan-approve"/);
  assert.match(source, /targetRoleId: "project-manager"/);
});

test("the implementation check requires the stored prompt and an open question", () => {
  const statement = checkQuery();
  assert.equal(statement.params[3], PROMPT);
  assert.deepEqual(
    implementationProblems({
      phase: "implementation",
      user_messages: "1",
      assistant_messages: 1,
      question_status: "open",
      has_document: false,
      has_delivered: false,
    }),
    [],
  );
  assert.deepEqual(
    implementationProblems({
      phase: "discovery",
      user_messages: 0,
      assistant_messages: 0,
      question_status: null,
      has_document: true,
      has_delivered: "t",
    }),
    [
      "phase=discovery",
      "user_messages=0",
      "assistant_messages=0",
      "question=absent",
      "document_html=present",
      "delivered_at=present",
    ],
  );
});
