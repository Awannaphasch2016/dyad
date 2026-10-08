import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  commandForPullRequest,
  transition,
} from "../../deploy/preview/transition.mjs";
import { previewBranchName } from "../../deploy/preview/neon.mjs";
import { previewRuntime, shellQuote } from "../../deploy/preview/render.mjs";

test("preview lifecycle creates, updates, and destroys one pull request", () => {
  assert.deepEqual(transition("absent", "create"), {
    state: "provisioning",
    effect: "up",
  });
  assert.deepEqual(transition("provisioning", "ready"), {
    state: "ready",
    effect: "none",
  });
  assert.deepEqual(transition("ready", "update"), {
    state: "updating",
    effect: "up",
  });
  assert.deepEqual(transition("updating", "ready"), {
    state: "ready",
    effect: "none",
  });
  assert.deepEqual(transition("ready", "destroy"), {
    state: "destroying",
    effect: "down",
  });
  assert.deepEqual(transition("destroying", "destroyed"), {
    state: "absent",
    effect: "none",
  });
  assert.deepEqual(transition("destroying", "update"), {
    state: "destroying",
    effect: "none",
  });
  assert.deepEqual(transition("ready", "unknown"), {
    state: "ready",
    effect: "none",
  });
});

test("a push without the preview label does not destroy an existing preview", () => {
  assert.equal(
    commandForPullRequest({ action: "synchronize", labels: [] }),
    "skip",
  );
  assert.equal(
    commandForPullRequest({ action: "synchronize", labels: ["preview"] }),
    "update",
  );
  assert.equal(
    commandForPullRequest({
      action: "unlabeled",
      label: "preview",
      labels: [],
    }),
    "destroy",
  );
  assert.equal(
    commandForPullRequest({ action: "closed", labels: ["preview"] }),
    "destroy",
  );
});

test("the preview database export uses the child branch, not the parent URL", () => {
  const parent = "postgresql://role:secret@parent.example/neondb";
  const child = "postgresql://role:other@child.example/neondb";
  const text = previewRuntime(
    {
      WEWEBPLUS_DATABASE_URL: parent,
      CLERK_PUBLISHABLE_KEY: "pk_test",
      CLOUDFLARE_API_TOKEN: "cf-token",
      CLOUDFLARE_ZONE_ID: "cf-zone",
      CLOUDFLARE_ACCOUNT_ID: "cf-account",
      CLOUDFLARE_API_TOKEN_: "must-not-export",
      CLOUDFLARE_ZONE_ID_: "must-not-export",
      EC2_SSH_KEY: "must-not-export",
      NEON_API_KEY: "must-not-export",
    },
    child,
  );
  assert.equal(text.includes(parent), false);
  assert.equal(text.includes("EC2_SSH_KEY"), false);
  assert.equal(text.includes("NEON_API_KEY"), false);
  assert.equal(text.includes("CLOUDFLARE_API_TOKEN_"), false);
  assert.equal(text.includes("CLOUDFLARE_ZONE_ID_"), false);
  assert.equal(text.includes("must-not-export"), false);
  assert.match(text, /export WEWEBPLUS_DATABASE_URL=/);
  assert.match(text, /export CLERK_PUBLISHABLE_KEY='pk_test'/);
  assert.match(text, /export CLOUDFLARE_API_TOKEN='cf-token'/);
  assert.match(text, /export CLOUDFLARE_ZONE_ID='cf-zone'/);
  assert.match(text, /export CLOUDFLARE_ACCOUNT_ID='cf-account'/);
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.equal(previewBranchName(20), "preview-pr-20");
  assert.throws(() => previewBranchName("20;rm"), /Pull request number/);
});

test("the controller decides from pull request events", () => {
  const result = spawnSync(
    process.execPath,
    [
      "deploy/preview/controller.mjs",
      "decide",
      "--action",
      "synchronize",
      "--labels",
      "preview,bug",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "update");
});

test("preview-up stores the database URL without printing it", () => {
  const script = readFileSync(
    new URL("./preview-up.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /upsert_env/);
  assert.match(script, /WEWEBPLUS_DATABASE_URL/);
  assert.equal(script.includes('echo "$WEWEBPLUS_DATABASE_URL"'), false);
});

test("the label workflow does not target production", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /commandForPullRequest|controller\.mjs decide/);
  assert.match(workflow, /devbox exec Wewebplus-ci/);
  assert.equal(workflow.includes("13.251.216.187"), false);
  assert.equal(workflow.includes("EC2_SSH_KEY"), false);
  assert.equal(workflow.includes("gascity-rollout"), false);
});
