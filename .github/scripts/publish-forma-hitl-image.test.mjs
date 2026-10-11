import assert from "node:assert/strict";
import test from "node:test";
import {
  assertImageWorkflow,
  imageWorkflow,
  FORMA_IMAGE_BRANCH,
} from "./publish-forma-hitl-image.mjs";

test("the image workflow publishes only the HITL image branch as the owner", () => {
  const workflow = imageWorkflow();
  assertImageWorkflow(workflow);
  assert.match(workflow, new RegExp(FORMA_IMAGE_BRANCH));
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /pk_live_|sk_live_|OPENAI_/);
});

test("assertImageWorkflow rejects an actor login", () => {
  assert.throws(
    () =>
      assertImageWorkflow(
        `branches:\n  - ${FORMA_IMAGE_BRANCH}\nusername: \${{ github.repository_owner }}\nusername: \${{ github.actor }}`,
      ),
    /actor/,
  );
});
