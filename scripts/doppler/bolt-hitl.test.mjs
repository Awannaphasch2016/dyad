import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SQL,
  decideAnswer,
  handleHitl,
  neonSqlEndpoint,
  patchFactoryPhaseBar,
  presentQuestion,
  verifySessionJwt,
} from "./bolt-hitl.mjs";

const env = {
  WEWEBPLUS_DATABASE_URL: "postgres://user:secret@ep.example.neon.tech/neondb",
  GAS_CITY_HOST_BRIDGE_TOKEN: "machine-token",
};

function questionRow(overrides = {}) {
  return {
    id: "q1",
    org_id: "org_wewebplus",
    app_id: "maple",
    phase: "discovery",
    run_id: "run-maple-1",
    step_id: "plan-approve",
    target_role_id: "project-manager",
    visibility: "role",
    status: "open",
    body: "Approve the Discovery plan for Maple Street Books.",
    idempotency_key: "run-maple-1:plan-approve",
    created_at: "2026-10-08T00:00:00Z",
    bead_id: "maple-plan",
    answered_by_user_id: null,
    answered_by_name: null,
    answered_at: null,
    ...overrides,
  };
}

function memory() {
  const questions = [];
  const answers = [];
  const apps = [
    { id: "maple", owner_type: "org", owner_id: "org_wewebplus" },
    { id: "harbor", owner_type: "org", owner_id: "org_harbor" },
    { id: "personal", owner_type: "user", owner_id: "user_pm" },
  ];
  const memberships = [
    { user_id: "user_pm", org_id: "org_wewebplus", role_id: "project-manager" },
    { user_id: "user_dev", org_id: "org_wewebplus", role_id: "developer" },
    {
      user_id: "user_harbor",
      org_id: "org_harbor",
      role_id: "project-manager",
    },
  ];
  return {
    questions,
    answers,
    async query(sql, params) {
      if (sql === SQL.app) {
        return apps.filter((app) => app.id === params[0]);
      }
      if (sql === SQL.memberships) {
        return memberships.filter((row) => row.user_id === params[0]);
      }
      if (sql === SQL.membership) {
        return memberships.filter(
          (row) => row.user_id === params[0] && row.org_id === params[1],
        );
      }
      if (sql === SQL.insertQuestion) {
        const key = params[8];
        const orgId = params[1];
        if (
          questions.some(
            (row) => row.org_id === orgId && row.idempotency_key === key,
          )
        ) {
          return [];
        }
        questions.push(questionRow({ id: params[0], org_id: orgId }));
        return [];
      }
      if (sql === SQL.questionByKey) {
        return questions.filter(
          (row) =>
            row.org_id === params[0] && row.idempotency_key === params[1],
        );
      }
      if (sql === SQL.listQuestions) {
        return questions.filter(
          (row) => row.org_id === params[0] && row.phase === params[1],
        );
      }
      if (sql === SQL.questionById) {
        return questions.filter((row) => row.id === params[0]);
      }
      if (sql === SQL.markAnswered) {
        const row = questions.find(
          (item) => item.id === params[0] && item.status === "open",
        );
        if (!row) return [];
        row.status = "answered";
        row.answered_by_user_id = params[1];
        row.answered_by_name = params[2];
        row.answered_at = params[3];
        return [{ id: row.id }];
      }
      if (sql === SQL.insertAnswer) {
        if (answers.some((row) => row.question_id === params[1])) return [];
        answers.push({
          id: params[0],
          question_id: params[1],
          body: params[3],
        });
        return [];
      }
      throw new Error(sql);
    },
  };
}

const createBody = {
  appId: "maple",
  phase: "discovery",
  runId: "run-maple-1",
  stepId: "plan-approve",
  targetRoleId: "project-manager",
  body: "Approve the Discovery plan for Maple Street Books.",
  idempotencyKey: "run-maple-1:plan-approve",
  gateBeadId: "maple-plan",
};

test("another organization does not see the question text", () => {
  const question = {
    orgId: "org_wewebplus",
    targetRoleId: "project-manager",
    status: "open",
    body: "Approve the plan",
    id: "q1",
    stepId: "plan-approve",
    answeredByName: null,
  };
  assert.equal(
    presentQuestion(question, {
      orgId: "org_harbor",
      roleId: "project-manager",
    }),
    null,
  );
  assert.equal(
    decideAnswer(question, { orgId: "org_harbor", roleId: "project-manager" }),
    "not-found",
  );
  const developer = presentQuestion(question, {
    orgId: "org_wewebplus",
    roleId: "developer",
  });
  assert.equal(developer.body, null);
  assert.equal(developer.canAnswer, false);
});

test("the machine posts one question and a repeat returns the same id", async () => {
  const store = memory();
  const first = await handleHitl({
    method: "POST",
    authorization: "Bearer machine-token",
    json: createBody,
    env,
    query: store.query,
    createId: "q1",
  });
  assert.equal(first.status, 201);
  const second = await handleHitl({
    method: "POST",
    authorization: "Bearer machine-token",
    json: createBody,
    env,
    query: store.query,
    createId: "q2",
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.id, "q1");
  assert.equal(store.questions.length, 1);
});

test("the matching role answers once and the gate stays unreleased", async () => {
  const store = memory();
  await handleHitl({
    method: "POST",
    authorization: "Bearer machine-token",
    json: createBody,
    env,
    query: store.query,
    createId: "q1",
  });
  const verifySession = async () => ({ userId: "user_pm" });
  const listed = await handleHitl({
    method: "GET",
    phase: "discovery",
    authorization: "Bearer session",
    env,
    query: store.query,
    verifySession,
  });
  assert.equal(listed.body.questions[0].body.includes("Maple Street"), true);
  assert.equal(listed.body.questions[0].canAnswer, true);
  const developer = await handleHitl({
    method: "GET",
    phase: "discovery",
    authorization: "Bearer session",
    env,
    query: store.query,
    verifySession: async () => ({ userId: "user_dev" }),
  });
  assert.equal(developer.body.questions[0].body, null);
  assert.equal(developer.body.questions[0].canAnswer, false);
  const forbidden = await handleHitl({
    method: "POST",
    questionId: "q1",
    answering: true,
    authorization: "Bearer session",
    json: { body: "approve" },
    env,
    query: store.query,
    verifySession: async () => ({ userId: "user_dev" }),
  });
  assert.equal(forbidden.status, 403);
  const harbor = await handleHitl({
    method: "POST",
    questionId: "q1",
    answering: true,
    authorization: "Bearer session",
    json: { body: "approve" },
    env,
    query: store.query,
    verifySession: async () => ({ userId: "user_harbor" }),
  });
  assert.equal(harbor.status, 404);
  const allowed = await handleHitl({
    method: "POST",
    questionId: "q1",
    answering: true,
    authorization: "Bearer session",
    json: { body: "approve" },
    env,
    query: store.query,
    verifySession,
    displayName: async () => "Anak",
    createId: "a1",
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.resolved, false);
  assert.equal(allowed.body.view.answeredByName, "Anak");
  const again = await handleHitl({
    method: "POST",
    questionId: "q1",
    answering: true,
    authorization: "Bearer session",
    json: { body: "approve again" },
    env,
    query: store.query,
    verifySession,
    displayName: async () => "Anak",
    createId: "a2",
  });
  assert.equal(again.body.resolved, false);
  assert.equal(store.answers.length, 1);
});

test("a personal app is not a gate", async () => {
  const store = memory();
  const result = await handleHitl({
    method: "POST",
    authorization: "Bearer machine-token",
    json: { ...createBody, appId: "personal" },
    env,
    query: store.query,
  });
  assert.equal(result.status, 409);
});

test("a session token verifies against its key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "k1";
  jwk.alg = "RS256";
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "k1" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "user_pm",
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url");
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey)
    .toString("base64url");
  const verified = await verifySessionJwt(`${header}.${payload}.${signature}`, {
    keys: [jwk],
  });
  assert.equal(verified.userId, "user_pm");
});

test("the question store address is the database host", () => {
  assert.equal(
    neonSqlEndpoint(env.WEWEBPLUS_DATABASE_URL),
    "https://ep.example.neon.tech/sql",
  );
});

test("the phase bar keeps the gate list", () => {
  const source = [
    "import type { FactoryPhaseComment } from '~/lib/factoryRun';",
    '      <p className="mt-2 text-xs text-bolt-elements-textSecondary">',
    "        {factoryPhaseHint(phase)}",
  ].join("\n");
  const patched = patchFactoryPhaseBar(source);
  assert.match(patched, /HitlGateList phase=\{phase\}/);
  assert.equal(patchFactoryPhaseBar(patched), patched);
});

test("the worker route leaves the gate unreleased", () => {
  const source = readFileSync(
    new URL("./bolt-hitl.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /resolved: false/);
  assert.equal(source.includes("json.orgId"), false);
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /bolt-hitl\.mjs/);
});
