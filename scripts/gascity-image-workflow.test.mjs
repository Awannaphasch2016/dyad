import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Gas City image workflow publishes the fork and does not touch production", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/gascity-image.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /repository: Awannaphasch2016\/gascity/);
  assert.match(workflow, /contrib\/k8s\/Dockerfile\.agent/);
  assert.match(workflow, /ghcr\.io\/awannaphasch2016\/gascity:preview/);
  assert.match(workflow, /docker pull/);
  assert.equal(workflow.includes("13.251.216.187"), false);
  assert.equal(workflow.includes("/opt/gascity"), false);
  assert.equal(workflow.includes("gascity-rollout"), false);
});
