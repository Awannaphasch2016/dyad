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
import {
  assignmentLog,
  assignPreviewDatabase,
  deletePreviewDatabase,
  redeployPreviewBranch,
} from "../../deploy/preview/vercel.mjs";

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
      CLOUDFLARE_ZONE_ID: "zone",
      CLOUDFLARE_ACCOUNT_ID: "account",
      EC2_SSH_KEY: "must-not-export",
      NEON_API_KEY: "must-not-export",
    },
    child,
  );
  assert.equal(text.includes(parent), false);
  assert.equal(text.includes("EC2_SSH_KEY"), false);
  assert.equal(text.includes("NEON_API_KEY"), false);
  assert.match(text, /export WEWEBPLUS_DATABASE_URL=/);
  assert.match(text, /export CLERK_PUBLISHABLE_KEY='pk_test'/);
  assert.match(text, /export CLOUDFLARE_API_TOKEN='cf-token'/);
  assert.match(text, /export CLOUDFLARE_ZONE_ID='zone'/);
  assert.match(text, /export CLOUDFLARE_ACCOUNT_ID='account'/);
  assert.equal(text.includes("CLOUDFLARE_API_TOKEN_"), false);
  const legacy = previewRuntime(
    {
      CLOUDFLARE_API_TOKEN_: "legacy-token",
      CLOUDFLARE_ZONE_ID_: "legacy-zone",
      CLOUDFLARE_ACCOUNT_ID_: "legacy-account",
    },
    child,
  );
  assert.match(legacy, /export CLOUDFLARE_API_TOKEN='legacy-token'/);
  assert.match(legacy, /export CLOUDFLARE_ZONE_ID='legacy-zone'/);
  assert.match(legacy, /export CLOUDFLARE_ACCOUNT_ID='legacy-account'/);
  assert.equal(legacy.includes("CLOUDFLARE_API_TOKEN_"), false);
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

test("a pull request git branch receives its own Neon database on Vercel preview", async () => {
  const child = "postgresql://role:secret@preview-pr-20.example/neondb";
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (url.endsWith("/v9/projects/dyad")) {
      return json({ id: "prj_dyad", name: "dyad", accountId: "team_test" });
    }
    if (url.includes("/env?") && (options.method || "GET") === "GET") {
      const created = calls.some((call) => call.method === "POST");
      return json({
        envs: [
          {
            id: "production-db",
            key: "WEWEBPLUS_DATABASE_URL",
            target: ["production"],
            gitBranch: null,
          },
          {
            id: "shared-preview-db",
            key: "WEWEBPLUS_DATABASE_URL",
            target: ["preview"],
          },
          ...(created
            ? [
                {
                  id: "env_pr20",
                  key: "WEWEBPLUS_DATABASE_URL",
                  target: ["preview"],
                  gitBranch: "cursor/preview-bridge-proof-9e7a",
                },
              ]
            : []),
        ],
      });
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.target, ["preview"]);
      assert.equal(body.gitBranch, "cursor/preview-bridge-proof-9e7a");
      assert.equal(body.key, "WEWEBPLUS_DATABASE_URL");
      assert.equal(body.value, child);
      return json({ created: { id: "env_pr20" } });
    }
    throw new Error(`unexpected ${options.method || "GET"} ${url}`);
  };
  const assigned = await assignPreviewDatabase({
    token: "token",
    project: "dyad",
    gitBranch: "cursor/preview-bridge-proof-9e7a",
    uri: child,
    fetchImpl,
  });
  const line = assignmentLog({
    ...assigned,
    pr: "20",
    neonBranch: "preview-pr-20",
  });
  assert.match(line, /pull request 20/);
  assert.match(line, /git branch cursor\/preview-bridge-proof-9e7a/);
  assert.match(line, /Neon preview-pr-20/);
  assert.match(line, /preview-pr-20\.example/);
  assert.match(line, /target preview/);
  assert.equal(line.includes("secret"), false);
  assert.equal(line.includes(child), false);
  assert.equal(
    calls.some((call) => (call.body || "").includes('"production"')),
    false,
  );
  await assert.rejects(
    () =>
      assignPreviewDatabase({
        token: "token",
        gitBranch: "main",
        uri: child,
        fetchImpl,
      }),
    /non-production git branch/,
  );
});

test("deleting a preview database removes only that git branch variable", async () => {
  const deleted = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/v9/projects/dyad")) {
      return json({ id: "prj_dyad", name: "dyad", accountId: "team_test" });
    }
    if ((options.method || "GET") === "GET") {
      return json({
        envs: [
          {
            id: "production-db",
            key: "WEWEBPLUS_DATABASE_URL",
            target: ["production"],
          },
          {
            id: "env_pr20",
            key: "WEWEBPLUS_DATABASE_URL",
            target: ["preview"],
            gitBranch: "cursor/preview-bridge-proof-9e7a",
          },
        ],
      });
    }
    if (options.method === "DELETE") {
      deleted.push(url);
      return json({});
    }
    throw new Error(`unexpected ${url}`);
  };
  const result = await deletePreviewDatabase({
    token: "token",
    gitBranch: "cursor/preview-bridge-proof-9e7a",
    fetchImpl,
  });
  assert.equal(result.deleted, true);
  assert.equal(result.envId, "env_pr20");
  assert.equal(deleted.length, 1);
  assert.match(deleted[0], /env_pr20/);
});

test("redeploy creates a preview deployment from the branch deployment", async () => {
  let body = {};
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || "GET") === "GET") {
      return json({
        deployments: [
          {
            uid: "dpl_prod",
            target: "production",
            meta: { githubCommitRef: "cursor/preview-bridge-proof-9e7a" },
          },
          {
            uid: "dpl_preview",
            target: null,
            url: "dyad-preview.vercel.app",
            meta: { githubCommitRef: "cursor/preview-bridge-proof-9e7a" },
          },
        ],
      });
    }
    body = JSON.parse(options.body);
    assert.equal(options.method, "POST");
    assert.match(url, /\/v13\/deployments\?teamId=team_test$/);
    return json({ url: "dyad-new.vercel.app" });
  };
  const result = await redeployPreviewBranch({
    token: "token",
    project: "dyad",
    projectId: "prj_dyad",
    teamId: "team_test",
    gitBranch: "cursor/preview-bridge-proof-9e7a",
    fetchImpl,
  });
  assert.equal(body.deploymentId, "dpl_preview");
  assert.equal(body.target, undefined);
  assert.equal(result.redeployed, true);
  assert.equal(result.url, "dyad-new.vercel.app");
});

function json(body) {
  return {
    ok: true,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("the label workflow does not target production", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /commandForPullRequest|controller\.mjs decide/);
  assert.match(workflow, /devbox exec Wewebplus-ci/);
  assert.match(
    workflow,
    /controller\.mjs attach --pr "\$PR" --git-branch "\$BRANCH" --vercel-project dyad/,
  );
  assert.match(
    workflow,
    /controller\.mjs attach --pr "\$pr" --git-branch "\$branch" --vercel-project dyad/,
  );
  assert.match(
    workflow,
    /controller\.mjs destroy --pr "\$pr" --git-branch "\$branch" --vercel-project dyad/,
  );
  assert.equal(workflow.includes("13.251.216.187"), false);
  assert.equal(workflow.includes("EC2_SSH_KEY"), false);
  assert.equal(workflow.includes("gascity-rollout"), false);
});
