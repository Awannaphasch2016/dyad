import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandForPullRequest } from "../../deploy/preview/transition.mjs";
import {
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  assertFormaTarget,
  formaBranchName,
  applyOpenRouterOverlay,
  includeDeploymentFile,
  openRouterOverlayFiles,
  previewEnv,
  previewVariablePayload,
  withDeploymentHostOrigin,
  withDeploymentHostOriginTest,
  selectVercelProject,
  secretMaskLines,
  sourceDeploymentBody,
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
  assert.equal(env.runtime.APP_URL, undefined);
  assert.equal(env.runtime.OPENAI_API_KEY, undefined);
  assert.equal(env.runtime.OPENROUTER_API_KEY, "sk-or-example");
  const updated = withDeploymentHostOrigin(
    'export function sameOrigin(request: Request) {\n  const expected = process.env.APP_URL || new URL(request.url).origin;\n  if (request.headers.get("origin") !== expected)\n    throw new HttpError(403, "Request origin is not allowed.");\n}\n',
  );
  assert.equal(updated.includes("originHost === requestHost"), true);
  assert.equal(withDeploymentHostOrigin(updated), updated);
  const tested = withDeploymentHostOriginTest(
    '  it("routes only executor connection and failure lifecycle webhooks", () => {\n',
  );
  assert.equal(tested.includes("allows the deployment host"), true);
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
  assert.equal(includeDeploymentFile("app/page.tsx"), true);
  assert.equal(includeDeploymentFile("node_modules/next/package.json"), false);
  assert.equal(includeDeploymentFile(".env.local"), false);
  const variable = previewVariablePayload("APP_PASSWORD", "pw");
  assert.deepEqual(variable.target, ["preview"]);
  assert.throws(
    () => previewVariablePayload("OPENAI_API_KEY", "sk-example"),
    /Refusing/,
  );
  const body = sourceDeploymentBody({ id: "prj_forma", name: "forma" }, [
    { file: "package.json", sha: "abc", size: 2 },
  ]);
  assert.equal(body.target, undefined);
  assert.equal(body.project, "prj_forma");
  assert.throws(
    () => sourceDeploymentBody({ id: "prj_dyad", name: "dyad" }, []),
    /Refusing to deploy/,
  );
});

test("the OpenRouter overlay is what the preview deploys", async () => {
  const files = await openRouterOverlayFiles();
  assert.ok(files.includes("lib/openrouter.ts"));
  assert.ok(files.includes("lib/openrouter-job.ts"));
  assert.ok(files.includes("lib/config.ts"));
  const checkout = await mkdtemp(join(tmpdir(), "forma-overlay-"));
  await applyOpenRouterOverlay(checkout);
  const config = await readFile(join(checkout, "lib/config.ts"), "utf8");
  assert.match(config, /OPENROUTER_API_KEY/);
  assert.match(config, /providerMode/);
  const worker = await readFile(join(checkout, "lib/worker.ts"), "utf8");
  assert.match(worker, /executeOpenRouterJob/);
  const studio = await readFile(
    join(checkout, "components/studio.tsx"),
    "utf8",
  );
  assert.equal(studio.includes(".env.local"), false);
  assert.match(studio, /provider === "openrouter"/);
  assert.match(studio, /OpenRouter × Vercel Sandbox/);
});
