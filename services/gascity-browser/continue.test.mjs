import assert from "node:assert/strict";
import test from "node:test";
import { continueRun, WEWEBPLUS_ORG_ID } from "./continue.mjs";

test("a run writes the gate into the preview database and asks Dyad", async () => {
  const rows = [];
  const calls = [];
  const result = await continueRun({
    prompt: "build the board",
    idempotencyKey: "gate-1",
    query: async (_text, params) => {
      rows.push(params);
    },
    dyadFetch: async (url, init) => {
      calls.push({ url, init });
      return { status: 202 };
    },
    dyadBase: "http://dyad:32100",
    bridgeToken: "bridge-token",
  });
  assert.equal(result.electronInvoked, false);
  assert.equal(result.dyadStatus, 202);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], WEWEBPLUS_ORG_ID);
  assert.equal(rows[0][5], "plan-approve");
  assert.equal(rows[0][6], "project-manager");
  assert.equal(rows[0][8], "open");
  assert.equal(rows[0][9], "build the board");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://dyad:32100/v1/apps/1/phases/implementation/runs",
  );
  assert.equal(calls[0].init.headers.authorization, "Bearer bridge-token");
  assert.equal(calls[0].init.body.includes("build the board"), true);
});

test("a refused Dyad run keeps the gate", async () => {
  let wrote = false;
  const result = await continueRun({
    prompt: "keep going",
    idempotencyKey: "gate-2",
    query: async () => {
      wrote = true;
    },
    dyadFetch: async () => ({ status: 409 }),
    dyadBase: "http://dyad:32100/",
    bridgeToken: "bridge-token",
  });
  assert.equal(wrote, true);
  assert.equal(result.dyadStatus, 409);
  assert.equal(result.electronInvoked, false);
});
