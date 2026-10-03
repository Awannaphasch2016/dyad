import assert from "node:assert/strict";
import test from "node:test";
import { isElectronCapability } from "../boundary.ts";
import {
  GAS_CITY_PATHS,
  parseAnswerBody,
  parseElectronCapabilityRequest,
  parseRunRequest,
} from "./contract.ts";

test("a run request is a prompt plus an idempotency key", () => {
  assert.deepEqual(
    parseRunRequest({ prompt: "  a one-page site  ", idempotencyKey: "key-1" }),
    { prompt: "a one-page site", idempotencyKey: "key-1" },
  );
  assert.equal(parseRunRequest({ prompt: "", idempotencyKey: "key-1" }), null);
  assert.equal(parseRunRequest({ prompt: "hi", idempotencyKey: "" }), null);
  assert.equal(GAS_CITY_PATHS.runs, "/v1/runs");
  assert.equal(
    GAS_CITY_PATHS.answer("q/1"),
    "/v1/hitl/questions/q%2F1/answers",
  );
});

test("answers and electron capabilities reject empty input", () => {
  assert.equal(parseAnswerBody({ body: "  approved  " }), "approved");
  assert.equal(parseAnswerBody({ body: "   " }), null);
  assert.deepEqual(
    parseElectronCapabilityRequest(
      { capability: "terminal", reason: "open a shell" },
      isElectronCapability,
    ),
    { capability: "terminal", reason: "open a shell" },
  );
  assert.equal(
    parseElectronCapabilityRequest(
      { capability: "chat", reason: "not local" },
      isElectronCapability,
    ),
    null,
  );
});
