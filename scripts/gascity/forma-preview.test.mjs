import assert from "node:assert/strict";
import test from "node:test";

import { commandForPullRequest } from "../../deploy/preview/transition.mjs";
import {
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  assertFormaTarget,
  formaBranchName,
  previewEnv,
} from "./forma-preview.mjs";

test("preview-forma does not share a decision with Dyad preview", () => {
  const removeDyad = {
    action: "unlabeled",
    label: "preview",
    labels: ["preview-forma"],
    closed: false,
  };
  assert.equal(commandForPullRequest(removeDyad), "destroy");
  assert.equal(commandForPullRequest(removeDyad, "preview-forma"), "skip");

  const removeForma = {
    action: "unlabeled",
    label: "preview-forma",
    labels: ["preview"],
    closed: false,
  };
  assert.equal(commandForPullRequest(removeForma), "skip");
  assert.equal(commandForPullRequest(removeForma, "preview-forma"), "destroy");
  assert.equal(
    commandForPullRequest(
      {
        action: "synchronize",
        labels: ["preview-forma"],
        closed: false,
      },
      "preview",
    ),
    "skip",
  );
  assert.equal(
    commandForPullRequest(
      {
        action: "synchronize",
        labels: ["preview-forma"],
        closed: false,
      },
      "preview-forma",
    ),
    "update",
  );
  assert.equal(
    commandForPullRequest(
      { action: "closed", labels: [], closed: true },
      "preview-forma",
    ),
    "destroy",
  );
  assert.equal(
    commandForPullRequest(
      {
        action: "labeled",
        label: "preview-forma",
        labels: ["preview-forma"],
        closed: true,
      },
      "preview-forma",
    ),
    "skip",
  );
});

test("a Forma preview branch stays inside the Forma Neon project", () => {
  assert.equal(formaBranchName(4), "forma-pr-4");
  assert.throws(() => formaBranchName("preview-pr-4"), /digits/);
  assert.equal(FORMA_NEON_PROJECT_ID, "divine-credit-21002460");
  assert.equal(FORMA_PARENT_BRANCH_ID, "br-round-night-b33xeq5p");
  assert.throws(
    () => assertFormaTarget("mute-credit-71067312", FORMA_PARENT_BRANCH_ID),
    /Refusing/,
  );
  assert.throws(
    () => assertFormaTarget(FORMA_NEON_PROJECT_ID, "br-mute-shadow-b3jxqoho"),
    /Refusing/,
  );
  const env = previewEnv({
    pooledUrl: "postgresql://role:secret@ep-example-pooler.neon.tech/neondb",
    directUrl: "postgresql://role:secret@ep-example.neon.tech/neondb",
    appUrl: "https://forma-example.vercel.app",
    secrets: {
      OPENROUTER_API_KEY: "sk-or-example",
      APP_PASSWORD: "pw",
      AUTH_SECRET: "auth",
      CRON_SECRET: "cron",
      OPENAI_API_KEY: "sk-example",
    },
  });
  assert.equal(env.runtime.DATABASE_URL.includes("-pooler"), true);
  assert.equal(env.build.DATABASE_URL.includes("-pooler"), false);
  assert.equal(env.runtime.OPENAI_API_KEY, undefined);
  assert.equal(env.runtime.OPENROUTER_API_KEY, "sk-or-example");
});
