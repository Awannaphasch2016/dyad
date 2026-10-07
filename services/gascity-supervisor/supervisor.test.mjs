import assert from "node:assert/strict";
import test from "node:test";
import { checkBridge, runSupervisor } from "./supervisor.mjs";

test("the supervisor calls the Dyad bridge and does not listen", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { status: 401 };
  };
  const controller = new AbortController();
  let sleeps = 0;
  await runSupervisor({
    baseUrl: "http://dyad:32100",
    fetchImpl,
    signal: controller.signal,
    log() {},
    sleep() {
      sleeps += 1;
      controller.abort();
    },
  });
  assert.deepEqual(calls, ["http://dyad:32100/v1/apps/0/factory-state"]);
  assert.equal(sleeps, 1);
  const result = await checkBridge("http://dyad:32100", fetchImpl);
  assert.equal(result.status, 401);
});

test("an unreachable bridge is reported and the process stays up", async () => {
  const notes = [];
  const controller = new AbortController();
  await runSupervisor({
    baseUrl: "http://dyad:32100",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
    signal: controller.signal,
    log(message) {
      notes.push(message);
    },
    sleep() {
      controller.abort();
    },
  });
  assert.deepEqual(notes, ["bridge unreachable"]);
});
