import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IMPLEMENTATION_QUESTION_ID } from "./bolt-workflow.mjs";
import { WALKTHROUGH_APP_ID, WALKTHROUGH_CHAT_ID } from "./bolt-sign-in.mjs";
import {
  PROMPT,
  checkQuery,
  countRecord,
  countsQuery,
  deliveredProblems,
  deliveredQuery,
  implementationProblems,
  neonRows,
  resetReport,
  resetStatements,
} from "./bolt-reset-project.mjs";

test("reset keeps the app and chat and clears the run", () => {
  const statements = resetStatements();
  assert.deepEqual(
    statements.map((statement) => statement.name),
    ["phase", "messages", "answers", "questions"],
  );
  assert.match(statements[0].query, /phase = 'discovery'/);
  assert.match(statements[0].query, /document_html = null/);
  assert.match(statements[0].query, /delivered_at = null/);
  assert.match(statements[0].query, /busy = false/);
  assert.deepEqual(statements[0].params, [WALKTHROUGH_APP_ID]);
  assert.deepEqual(statements[1].params, [WALKTHROUGH_CHAT_ID]);
  assert.deepEqual(statements[2].params, [IMPLEMENTATION_QUESTION_ID]);
  assert.deepEqual(statements[3].params, [IMPLEMENTATION_QUESTION_ID]);
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
  const pattern = new RegExp(PROMPT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const file of [
    "../../e2e-walkthrough/tests/pm-discovery.spec.ts",
    "../../e2e-walkthrough/tests/two-roles.spec.ts",
  ]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), pattern);
  }
});

test("delivered requires the answer, the document, and the timestamp", () => {
  const statement = deliveredQuery();
  assert.match(statement.query, /wewebplus\.answers/);
  assert.equal(statement.params[3], PROMPT);
  assert.deepEqual(
    deliveredProblems({
      phase: "delivered",
      user_messages: 1,
      assistant_messages: "1",
      question_status: "answered",
      answers: "1",
      has_document: true,
      has_delivered: "t",
    }),
    [],
  );
  assert.deepEqual(
    deliveredProblems({
      phase: "implementation",
      user_messages: 1,
      assistant_messages: 1,
      question_status: "open",
      answers: 0,
      has_document: false,
      has_delivered: false,
    }),
    [
      "phase=implementation",
      "question=open",
      "answers=0",
      "document_html=absent",
      "delivered_at=absent",
    ],
  );
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
