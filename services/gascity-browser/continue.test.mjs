import assert from "node:assert/strict";
import test from "node:test";
import { continueRun, WEWEBPLUS_ORG_ID } from "./continue.mjs";

function memoryQuery(rows) {
  return async (text, params) => {
    if (text.includes("insert into")) {
      const key = params[10];
      if (rows.some((row) => row.idempotencyKey === key)) return [];
      const row = {
        runId: params[4],
        idempotencyKey: key,
        stepId: params[5],
        role: params[6],
        status: params[8],
        body: params[9],
        orgId: params[1],
        appId: params[2],
      };
      rows.push(row);
      return [{ run_id: row.runId }];
    }
    return rows
      .filter(
        (row) => row.orgId === params[0] && row.idempotencyKey === params[1],
      )
      .map((row) => ({ run_id: row.runId }));
  };
}

test("a run writes the gate and does not call Dyad", async () => {
  const rows = [];
  const result = await continueRun({
    prompt: "build the board",
    idempotencyKey: "gate-1",
    query: memoryQuery(rows),
    dyadFetch: async () => {
      throw new Error("Dyad must not be called");
    },
  });
  assert.equal(result.electronInvoked, false);
  assert.equal(result.stored, true);
  assert.equal(result.dyadStatus, undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orgId, WEWEBPLUS_ORG_ID);
  assert.equal(rows[0].appId, "preview");
  assert.equal(rows[0].stepId, "plan-approve");
  assert.equal(rows[0].role, "project-manager");
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].body, "build the board");
  assert.match(result.runId, /^gascity-run:/);
});

test("the same idempotency key does not insert a second row", async () => {
  const rows = [];
  const query = memoryQuery(rows);
  const first = await continueRun({
    prompt: "build the board",
    idempotencyKey: "gate-1",
    query,
  });
  const second = await continueRun({
    prompt: "build the board",
    idempotencyKey: "gate-1",
    query,
  });
  assert.equal(rows.length, 1);
  assert.equal(second.stored, true);
  assert.equal(second.runId, first.runId);
  assert.equal(second.electronInvoked, false);
});
