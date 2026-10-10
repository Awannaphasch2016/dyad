import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFollowUpPrompt,
  buildPrompt,
  explicitStartingSha,
  promptFor,
} from "./start-worker.mjs";
import { LEAK_MARKERS } from "./lib.mjs";

const RUN = "2026-10-10-gitcon-v1-speckit-02";
const SHA = "bc32948cb4dd2b5cfa051c24d92ff0771f053a93";

test("a follow-up prompt keeps the existing specification and names the 301", () => {
  const text = buildFollowUpPrompt(RUN);
  assert.match(text, new RegExp(`exp/${RUN}`));
  assert.match(text, /POST \/contact answered 301/);
  assert.match(text, /public\/contact\//);
  assert.match(text, /Docker image/);
  assert.doesNotMatch(text, /<<<SPEC/);
  assert.doesNotMatch(text, /Save the specification/);
  assert.doesNotMatch(text, /speckit-specify/);
  for (const marker of LEAK_MARKERS) {
    assert.equal(text.toLowerCase().includes(marker.toLowerCase()), false);
  }
});

test("promptFor uses the follow-up text only when the run asks for it", () => {
  const spec = "SPEC BODY THAT MUST NOT LEAK INTO THE FIX PROMPT";
  const fix = promptFor({ follow_up: true }, spec, RUN);
  assert.equal(fix.includes(spec), false);
  const first = promptFor({ follow_up: false }, spec, RUN);
  assert.equal(first, buildPrompt(spec, RUN));
  assert.match(first, /<<<SPEC/);
  assert.match(first, /Save the specification/);
});

test("explicitStartingSha accepts only a 40-character commit", () => {
  assert.equal(explicitStartingSha({ starting_sha: SHA }), SHA);
  assert.equal(explicitStartingSha({ starting_sha: "baseline/speckit-1.1.2" }), null);
  assert.equal(explicitStartingSha({}), null);
});
