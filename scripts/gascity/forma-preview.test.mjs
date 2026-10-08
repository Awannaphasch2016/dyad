import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { commandForPullRequest } from "../../deploy/preview/transition.mjs";
import {
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  assertFormaCommitSource,
  assertFormaTarget,
  assertPreviewEnvironment,
  dockerignoreWithSecretsExcluded,
  formaBranchName,
  formaDockerfile,
  formaImageTag,
  formaPreviewComment,
  includeDeploymentFile,
  resolveFormaPreviewTarget,
  previewEnv,
  previewVariablePayload,
  requestedFormaSha,
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

test("the preview deploys a Forma commit instead of copying the editor", async () => {
  const source = await readFile(
    new URL("./forma-preview.mjs", import.meta.url),
    "utf8",
  );
  const migrateStart = source.indexOf("async function migrate");
  const migrateEnd = source.indexOf("\nasync function probeStatus");
  const migrate = source.slice(migrateStart, migrateEnd);
  assert.equal(migrate.includes("applyOpenRouterOverlay"), false);
  assert.equal(migrate.includes("publishOpenRouterCommit"), false);
  assert.equal(migrate.includes("publishSignInFix"), false);
  const runStart = source.indexOf("export async function runFormaPreview");
  const run = source.slice(runStart);
  assert.equal(run.includes("publishSignInFix"), false);
  assert.equal(run.includes("applyOpenRouterOverlay"), false);
  assert.equal(run.includes("ensureWalkthroughPullRequest"), false);
  const head = "b".repeat(40);
  assert.deepEqual(resolveFormaPreviewTarget({ pr: "2", headSha: head }), {
    pr: "2",
    sha: head,
    comment: true,
  });
  assert.deepEqual(resolveFormaPreviewTarget({ sha: head }), {
    pr: "",
    sha: head,
    comment: false,
  });
  assert.throws(
    () => resolveFormaPreviewTarget({}),
    /commit SHA or pull request number is required/,
  );
  assert.throws(
    () =>
      resolveFormaPreviewTarget({
        pr: "2",
        sha: "c".repeat(40),
        headSha: head,
      }),
    /does not match the pull request head/,
  );
  assert.equal(assertPreviewEnvironment(""), "preview");
  assert.equal(assertPreviewEnvironment("preview"), "preview");
  assert.throws(
    () => assertPreviewEnvironment("production"),
    /Only the preview environment is implemented/,
  );
  assert.equal(requestedFormaSha(""), "");
  const sha = "a".repeat(40);
  assert.equal(requestedFormaSha(sha), sha);
  assert.throws(() => requestedFormaSha("abc"), /40 hex/);
  assert.equal(formaImageTag(sha), `ghcr.io/awannaphasch2016/forma:sha-${sha}`);
  assert.equal(
    assertFormaCommitSource(
      "if (originHost === requestHost) return;",
      'const base = "https://openrouter.ai/api/v1";',
    ),
    true,
  );
  assert.equal(
    assertFormaCommitSource("const expected = process.env.APP_URL", ""),
    false,
  );
  assert.equal(
    formaPreviewComment("https://forma.example", sha).includes(sha),
    true,
  );
  assert.equal(
    dockerignoreWithSecretsExcluded(".git\nnode_modules\n"),
    ".git\nnode_modules\n.env\n.env.*\n.next\n",
  );
  assert.equal(
    dockerignoreWithSecretsExcluded(
      ".env\n.env.*\n.git\nnode_modules\n.next\n",
    ),
    null,
  );
  assert.equal(formaDockerfile().includes("DATABASE_URL"), false);
  assert.equal(formaDockerfile().includes("OPENROUTER"), false);
  const workflow = await readFile(
    new URL("../../deploy/forma/publish-image.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: Publish Forma image/);
  assert.match(workflow, /ghcr\.io\/awannaphasch2016\/forma:sha-/);
  assert.match(workflow, /forma_image=ghcr\.io\/awannaphasch2016\/forma@/);
  assert.equal(workflow.includes("OPENROUTER"), false);
  assert.equal(workflow.includes("DATABASE_URL"), false);
  const preview = await readFile(
    new URL("../../.github/workflows/preview-forma.yml", import.meta.url),
    "utf8",
  );
  assert.match(preview, /name: preview-forma/);
  assert.match(preview, /repository_dispatch/);
  assert.match(preview, /types: \[preview-forma\]/);
  assert.match(preview, /FORMA_SHA/);
  assert.match(preview, /FORMA_ENVIRONMENT/);
  assert.equal(preview.includes("pull_request:"), false);
  assert.equal(preview.includes("packages: write"), false);
  assert.match(preview, /permission-workflows: write/);
});
