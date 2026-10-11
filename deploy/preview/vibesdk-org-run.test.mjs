import assert from "node:assert/strict";
import test from "node:test";
import {
  CREATE_REFUSAL,
  DEV_ROLE,
  ENTER_REFUSAL,
  PM_ROLE,
  SECOND_ANSWER,
  WAITING_DEV,
  WAITING_PM,
  acceptTurn,
  assignRole,
  canCreate,
  firstQuestion,
  orgControllerSource,
  orgPopupSource,
  orgRoutesSource,
  orgRunSource,
  presentQuestion,
  redactQuestionText,
} from "./vibesdk-org-run.mjs";

test("a missing role is kept for the project manager and marked fallback", () => {
  assert.deepEqual(assignRole(undefined), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.deepEqual(assignRole("architect"), {
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
  assert.equal(assignRole(DEV_ROLE).assignment, "declared");
});

test("the other role sees a waiting line and not the question", () => {
  const question = {
    status: "open",
    targetRole: PM_ROLE,
    body: "What should the shop sell?",
  };
  assert.deepEqual(presentQuestion(question, DEV_ROLE), {
    body: null,
    waiting: WAITING_PM,
    canAnswer: false,
  });
  assert.equal(presentQuestion(question, PM_ROLE).body, question.body);
  assert.equal(presentQuestion(question, PM_ROLE).canAnswer, true);
});

test("only the named role's first reply is accepted", () => {
  const open = { status: "open", targetRole: DEV_ROLE, body: "Which page?" };
  assert.equal(acceptTurn({ open, role: PM_ROLE, answer: "home" }).allow, false);
  assert.equal(
    acceptTurn({ open, role: PM_ROLE, answer: "home" }).message,
    WAITING_DEV,
  );
  assert.equal(acceptTurn({ open, role: DEV_ROLE, answer: "  " }).message, ENTER_REFUSAL);
  assert.equal(acceptTurn({ open, role: DEV_ROLE, answer: "The menu page" }).allow, true);
  assert.equal(
    acceptTurn({ open, role: DEV_ROLE, answer: "again", alreadyAnswered: true }).message,
    SECOND_ANSWER,
  );
  assert.equal(acceptTurn({ open: null, role: PM_ROLE, answer: "later" }).message, ENTER_REFUSAL);
});

test("only the project manager can create an organization app", () => {
  assert.equal(canCreate(PM_ROLE), true);
  assert.equal(canCreate(DEV_ROLE), false);
  assert.equal(canCreate("architect"), false);
});

test("one question is stored and an unknown role falls back", () => {
  const parsed = firstQuestion({
    questions: [
      { question: " What is the shop called? ", targetRole: "architect" },
      { question: "Which file?" },
    ],
  });
  assert.deepEqual(parsed, {
    body: "What is the shop called?",
    targetRole: PM_ROLE,
    assignment: "fallback",
  });
});

test("the other role's transcript loses the question body", () => {
  const body = "What should the shop sell?";
  const hidden = redactQuestionText(
    { message: body, tool: { name: "ask_questions", args: { questions: [{ question: body }] } } },
    DEV_ROLE,
    [{ body, targetRole: PM_ROLE }],
  );
  assert.equal(JSON.stringify(hidden).includes(body), false);
  assert.match(JSON.stringify(hidden), new RegExp(WAITING_PM.replace(".", "\\.")));
});

test("the generated run does not keep the extra card or a phase", () => {
  const run = orgRunSource();
  const controller = orgControllerSource();
  const routes = orgRoutesSource();
  const popup = orgPopupSource();
  for (const source of [run, controller, routes, popup]) {
    assert.equal(source.includes("hitl_"), false);
    assert.equal(source.includes("phase"), false);
    assert.equal(source.includes("plan-approve"), false);
    assert.equal(source.includes("owner_type"), false);
  }
  assert.match(run, /org_id/);
  assert.match(run, /created_by/);
  assert.match(run, /target_role_id/);
  assert.match(run, /question_id TEXT PRIMARY KEY/);
  assert.match(run, new RegExp(CREATE_REFUSAL));
  assert.equal(popup.includes("<input"), false);
  assert.equal(popup.includes("<textarea"), false);
  assert.match(popup, /data-testid="org-question"/);
  assert.match(popup, /Reply in the prompt box/);
  assert.match(routes, /\/api\/org/);
});
