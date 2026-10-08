import assert from "node:assert/strict";
import test from "node:test";

import { commandForPullRequest } from "../../deploy/preview/transition.mjs";
import {
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  assertFormaTarget,
  formaBranchName,
  previewEnv,
  selectVercelProject,
  secretMaskLines,
  VERCEL_TOKEN_SOURCES,
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

test("a Forma token uses the one visible project and never the dyad project", () => {
  assert.equal(
    selectVercelProject([{ id: "prj_forma", name: "forma" }]).name,
    "forma",
  );
  assert.equal(
    selectVercelProject([
      { id: "prj_studio", name: "openai-agents-api-v0-clone" },
    ]).name,
    "openai-agents-api-v0-clone",
  );
  assert.equal(
    selectVercelProject([
      { id: "prj_dyad", name: "dyad" },
      { id: "prj_studio", name: "openai-agents-api-v0-clone" },
    ]).name,
    "openai-agents-api-v0-clone",
  );
  assert.equal(
    VERCEL_TOKEN_SOURCES.some(([project, config]) =>
      /prd|prod/i.test(`${project} ${config}`),
    ),
    false,
  );
  const lines = secretMaskLines(
    "-----BEGIN PRIVATE KEY-----\nline-one-secret-value\nline-two-secret-value\n-----END PRIVATE KEY-----",
  );
  assert.equal(
    lines.some((line) => line.includes("\n")),
    false,
  );
  assert.deepEqual(lines, [
    "-----BEGIN PRIVATE KEY-----",
    "line-one-secret-value",
    "line-two-secret-value",
    "-----END PRIVATE KEY-----",
  ]);
  assert.equal(
    selectVercelProject([{ id: "prj_studio", name: "studio" }], "prj_studio")
      .id,
    "prj_studio",
  );
  assert.throws(
    () => selectVercelProject([{ id: "prj_dyad", name: "dyad" }]),
    /only sees the dyad project/,
  );
  assert.throws(
    () => selectVercelProject([{ id: "prj_dyad", name: "dyad" }], "prj_dyad"),
    /Refusing to deploy/,
  );
  assert.equal(
    selectVercelProject([
      { id: "prj_a", name: "alpha" },
      { id: "prj_b", name: "beta" },
    ]),
    null,
  );
});
