import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = readFileSync(
  new URL("./harness-image.sh", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/harness-image-compare.yml", import.meta.url),
  "utf8",
);
const pipeline = readFileSync(
  new URL("../../deploy/harness/images.yaml", import.meta.url),
  "utf8",
);

test("harness image tags stay off the live preview tags", () => {
  for (const text of [script, workflow, pipeline]) {
    assert.equal(text.includes("13.251.216.187"), false);
    assert.equal(text.includes("gascity-rollout"), false);
    assert.equal(text.includes("gascity:preview"), false);
    assert.equal(text.includes("dyad:sha-"), false);
    assert.equal(text.includes("dyad:ctx-"), false);
  }
  assert.match(script, /\*:preview/);
  assert.match(script, /\*:sha-\*/);
  assert.match(script, /preview-image-id\.mjs/);
  assert.match(script, /GAS_CITY_HOST_BRIDGE_ENABLED=true/);
  assert.match(script, /IMAGE_TAG_PREFIX:-harness/);
  assert.match(workflow, /IMAGE_TAG_PREFIX: harness-gha/);
  assert.match(pipeline, /IMAGE_TAG_PREFIX: harness/);
  assert.match(pipeline, /cursor\/harness-images-5527/);
});

test("the GitHub App login self-test does not print a private key", () => {
  const result = spawnSync(
    "python3",
    ["scripts/harness/ghcr_app_login.py", "--self-test"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self_test=ok/);
  assert.equal(result.stdout.includes("PRIVATE KEY"), false);
  assert.equal(result.stderr.includes("PRIVATE KEY"), false);
});
