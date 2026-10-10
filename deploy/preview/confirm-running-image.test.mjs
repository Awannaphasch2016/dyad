import assert from "node:assert/strict";
import test from "node:test";
import {
  dyadImageTag,
  expectedCanaryImageTag,
  imageDecision,
  previousCanaryImageTag,
} from "./confirm-running-image.mjs";

const image = (tag) =>
  `755283537543.dkr.ecr.ap-southeast-1.amazonaws.com/wewebplus-dyad:${tag}`;

function task(tag, lastStatus = "RUNNING") {
  return {
    lastStatus,
    desiredStatus: "RUNNING",
    containers: [
      { name: "gascity", image: "example/gascity:supervisor" },
      { name: "dyad", image: image(tag) },
    ],
  };
}

test("the dyad tag is the image suffix", () => {
  assert.equal(
    dyadImageTag(task(expectedCanaryImageTag)),
    expectedCanaryImageTag,
  );
});

test("promotion waits while the previous image is the running task", () => {
  const decision = imageDecision({ tasks: [task(previousCanaryImageTag)] });
  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "previous");
});

test("promotion proceeds only for the expected running image", () => {
  const decision = imageDecision({ tasks: [task(expectedCanaryImageTag)] });
  assert.deepEqual(decision, { ready: true, tag: expectedCanaryImageTag });
});

test("an unknown image is not treated as the previous task", () => {
  const decision = imageDecision({ tasks: [task("canary-other")] });
  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "unexpected");
  assert.equal(decision.tag, "canary-other");
});

test("a stopped task is not the running image", () => {
  const decision = imageDecision({
    tasks: [task(expectedCanaryImageTag, "STOPPED")],
  });
  assert.equal(decision.ready, false);
  assert.equal(decision.reason, "none");
});
