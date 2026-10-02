import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAnswer,
  presentQuestion,
  type HitlCaller,
  type HitlQuestionRecord,
} from "./hitl.ts";

const createdAt = new Date("2026-10-01T00:00:00.000Z");

function question(
  overrides: Partial<HitlQuestionRecord> = {},
): HitlQuestionRecord {
  return {
    id: "q1",
    orgId: "org_wewebplus",
    appId: "1",
    phase: "discovery",
    runId: "run-1",
    stepId: "plan-approve",
    targetRoleId: "project-manager",
    visibility: "role",
    status: "open",
    body: "Approve the plan",
    idempotencyKey: "run-1:plan-approve",
    createdAt,
    beadId: "bead-1",
    answeredByUserId: null,
    answeredByName: null,
    answeredAt: null,
    ...overrides,
  };
}

const manager: HitlCaller = {
  orgId: "org_wewebplus",
  userId: "user_pm",
  roleId: "project-manager",
  displayName: "Anak Wannaphaschaiyong",
};

const developer: HitlCaller = {
  ...manager,
  userId: "user_dev",
  roleId: "developer",
  displayName: "awannaphasch2016",
};

test("the matching role sees the body and can answer", () => {
  const view = presentQuestion(question(), manager);
  assert.equal(view?.body, "Approve the plan");
  assert.equal(view?.canAnswer, true);
  assert.equal(decideAnswer(question(), manager).kind, "allow");
});

test("another role in the org sees status only", () => {
  const view = presentQuestion(question(), developer);
  assert.equal(view?.body, null);
  assert.equal(view?.canAnswer, false);
  assert.equal(view?.status, "open");
  assert.equal(decideAnswer(question(), developer).kind, "forbidden");
});

test("someone outside the org is absent", () => {
  const outsider = { ...manager, orgId: "org_other" };
  assert.equal(presentQuestion(question(), outsider), null);
  assert.equal(decideAnswer(question(), outsider).kind, "not-found");
  assert.equal(presentQuestion(question(), null), null);
});

test("an answered question stays visible and cannot be answered again", () => {
  const answered = question({
    status: "answered",
    answeredByName: "Anak Wannaphaschaiyong",
    answeredAt: createdAt,
  });
  const view = presentQuestion(answered, manager);
  assert.equal(view?.body, "Approve the plan");
  assert.equal(view?.canAnswer, false);
  assert.equal(decideAnswer(answered, manager).kind, "already-answered");
});
