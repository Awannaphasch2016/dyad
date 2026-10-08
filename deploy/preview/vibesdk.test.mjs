import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deletePreviewResources,
  ensurePreviewResources,
} from "./vibesdk-cloudflare.mjs";
import {
  decideFromEvent,
  provisionPreview,
  upsertPreviewComment,
  waitForHealth,
} from "./vibesdk-preview.mjs";
import {
  BUILDER_NOTE,
  LAB_D1_ID,
  PREVIEW_COMMENT_MARKER,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
  previewCommentBody,
  previewConfigViolations,
  previewNames,
  previewWranglerConfig,
} from "./vibesdk.mjs";

const accountId = "a".repeat(32);
const token = "t".repeat(40);
const databaseId = "11111111-2222-3333-4444-555555555555";
const kvId = "b".repeat(32);

function creds(extra = {}) {
  return {
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    OPENROUTER_API_KEY: `sk-or-${"k".repeat(24)}`,
    ...extra,
  };
}

function jsonResponse(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("a pull request gets its own workers.dev name", () => {
  const names = previewNames(12);
  assert.deepEqual(names, {
    pr: "12",
    worker: "vibesdk-pr-12",
    d1: "vibesdk-pr-12",
    kv: "vibesdk-pr-12",
    r2: "vibesdk-pr-12",
    host: "vibesdk-pr-12.karant-test-egress-canary.workers.dev",
    url: "https://vibesdk-pr-12.karant-test-egress-canary.workers.dev",
  });
  assert.throws(() => previewNames("12;rm"), /Pull request number/);
});

test("the preview config points Think at OpenRouter and refuses shared resources", () => {
  const names = previewNames(12);
  const config = previewWranglerConfig({
    accountId,
    databaseId,
    kvId,
    names,
  });
  assert.deepEqual(previewConfigViolations(config, names), []);
  assert.equal(config.vars.CUSTOM_DOMAIN, names.host);
  assert.equal(config.vars.CLOUDFLARE_AI_GATEWAY, undefined);
  assert.equal(config.workers_dev, true);
  const text = JSON.stringify(config);
  assert.equal(text.includes("vibesdk-lab"), false);
  assert.equal(text.includes("vibesdk-production"), false);
  assert.equal(text.includes("build.cloudflare.dev"), false);
  assert.equal(text.includes(PRODUCTION_DATABASE_ID), false);
  assert.equal(text.includes(PRODUCTION_KV_ID), false);
  assert.equal(text.includes(LAB_D1_ID), false);
  assert.throws(
    () =>
      previewWranglerConfig({
        accountId,
        databaseId: PRODUCTION_DATABASE_ID,
        kvId,
        names,
      }),
    /refusing production d1/,
  );
  assert.throws(
    () =>
      previewWranglerConfig({
        accountId,
        databaseId: LAB_D1_ID,
        kvId,
        names,
      }),
    /refusing lab d1/,
  );
});

test("the pinned Think sources are patched onto OpenRouter", () => {
  const model = patchThinkModel(`
    export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';
    name: 'Gemini 3.6 Flash',
    provider: 'google-ai-studio',
  `);
  assert.match(model, /anthropic\/claude-sonnet-4\.5/);
  assert.match(model, /provider: 'openrouter'/);
  assert.match(model, /directOverride: true/);
  const routing = patchThinkRouting(`
    const usesStoredKeys = !conf.defaultHeaders?.['cf-aig-authorization'];
    if (gatewayToken && !headers['cf-aig-authorization']) {
    if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY) {
    async build(): Promise<void> {
  `);
  assert.match(routing, /directOpenRouter/);
  assert.match(routing, /await this\.configureThinkAgent\(\)/);
  const entry = patchWorkerExports(
    "export { UserAppSandboxService } from './services/sandbox/sandboxSdkClient';\n",
  );
  assert.equal(entry.includes("UserAppSandboxService"), false);
});

test("comments name the builder and the preview URL", () => {
  const names = previewNames(12);
  const ready = previewCommentBody("ready", names);
  assert.match(ready, new RegExp(PREVIEW_COMMENT_MARKER));
  assert.match(ready, new RegExp(names.url.replaceAll(".", "\\.")));
  assert.match(ready, new RegExp(BUILDER_NOTE));
  assert.match(previewCommentBody("provisioning"), /provisioning/);
  assert.match(previewCommentBody("failed"), /was not updated/);
  assert.match(
    previewCommentBody("removed", names),
    /Removed Vibe SDK preview/,
  );
});

test("creating resources refuses a production database before deploy", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      provisionPreview({
        pr: "70",
        env: creds(),
        request: async (method, path) => {
          calls.push(`${method} ${path}`);
          if (method === "GET") {
            return { status: 200, payload: { success: true, result: [] } };
          }
          if (path.includes("/d1/")) {
            return {
              status: 200,
              payload: {
                success: true,
                result: { name: "vibesdk-pr-70", uuid: PRODUCTION_DATABASE_ID },
              },
            };
          }
          return {
            status: 200,
            payload: {
              success: true,
              result: { id: kvId, name: "vibesdk-pr-70" },
            },
          };
        },
        run: async () => {
          throw new Error("deploy should not start");
        },
      }),
    /refusing production d1/,
  );
  assert.equal(
    calls.some((call) => call.startsWith("DELETE")),
    false,
  );
});

test("a second delete finds nothing and makes no delete call", async () => {
  const calls = [];
  const request = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === "GET" && path.includes("/workers/scripts/")) {
      return { status: 404, payload: {} };
    }
    return { status: 200, payload: { success: true, result: [] } };
  };
  const first = await deletePreviewResources({
    request,
    accountId,
    pr: "70",
  });
  const second = await deletePreviewResources({
    request,
    accountId,
    pr: "70",
  });
  assert.equal(first.d1.deleted, false);
  assert.equal(second.worker.deleted, false);
  assert.equal(second.d1.deleted, false);
  assert.equal(
    calls.some((call) => call.startsWith("DELETE")),
    false,
  );
});

test("delete refuses the lab database id", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      deletePreviewResources({
        accountId,
        pr: "70",
        request: async (method, path) => {
          calls.push(`${method} ${path}`);
          if (path.includes("/workers/scripts/")) {
            return { status: 404, payload: {} };
          }
          if (path.includes("/d1/")) {
            return {
              status: 200,
              payload: {
                success: true,
                result: [{ name: "vibesdk-pr-70", uuid: LAB_D1_ID }],
              },
            };
          }
          return { status: 200, payload: { success: true, result: [] } };
        },
      }),
    /refusing lab d1/,
  );
  assert.equal(
    calls.some((call) => call.startsWith("DELETE")),
    false,
  );
});

test("an existing preview database is reused", async () => {
  let created = false;
  const posts = [];
  const request = async (method, path, body) => {
    if (method === "POST") posts.push(path);
    if (path.includes("/d1/")) {
      if (method === "GET") {
        return {
          status: 200,
          payload: {
            success: true,
            result: created
              ? [{ name: "vibesdk-pr-70", uuid: databaseId }]
              : [],
          },
        };
      }
      created = true;
      return {
        status: 200,
        payload: {
          success: true,
          result: { name: body.name, uuid: databaseId },
        },
      };
    }
    if (path.includes("/storage/kv/")) {
      return {
        status: 200,
        payload: {
          success: true,
          result: [{ id: kvId, title: "vibesdk-pr-70" }],
        },
      };
    }
    return {
      status: 200,
      payload: { success: true, result: [{ name: "vibesdk-pr-70" }] },
    };
  };
  const ensured = await ensurePreviewResources({
    accountId,
    pr: "70",
    request,
  });
  assert.equal(ensured.databaseId, databaseId);
  assert.equal(ensured.kvId, kvId);
  const again = await ensurePreviewResources({
    accountId,
    pr: "70",
    request,
  });
  assert.equal(again.databaseId, databaseId);
  assert.deepEqual(posts, ["/accounts/" + accountId + "/d1/database"]);
});

test("preview-vibesdk decisions stay on that label", () => {
  assert.equal(
    decideFromEvent({
      action: "synchronize",
      labels: ["preview"],
    }),
    "skip",
  );
  assert.equal(
    decideFromEvent({
      action: "labeled",
      label: "preview-vibesdk",
      labels: ["preview-vibesdk"],
    }),
    "update",
  );
  assert.equal(decideFromEvent({ action: "closed", labels: [] }), "destroy");
});

test("the status comment is created once and then updated", async () => {
  const calls = [];
  const comments = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(`${options.method || "GET"} ${url}`);
    if (!options.method) return jsonResponse(200, comments);
    const body = JSON.parse(options.body).body;
    if (options.method === "POST") {
      comments.push({ id: 9, body });
      return jsonResponse(201, comments[0]);
    }
    comments[0].body = body;
    return jsonResponse(200, comments[0]);
  };
  const names = previewNames(12);
  const created = await upsertPreviewComment({
    repo: "Awannaphasch2016/dyad",
    pr: "12",
    token: "github-token",
    body: previewCommentBody("provisioning"),
    fetchImpl,
  });
  const updated = await upsertPreviewComment({
    repo: "Awannaphasch2016/dyad",
    pr: "12",
    token: "github-token",
    body: previewCommentBody("ready", names),
    fetchImpl,
  });
  assert.equal(created.updated, false);
  assert.equal(updated.updated, true);
  assert.match(comments[0].body, /vibesdk-pr-12/);
  assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
});

test("health checks the preview host only", async () => {
  let hits = 0;
  const status = await waitForHealth(
    previewNames(12).url,
    async () => {
      hits += 1;
      return { status: hits === 1 ? 503 : 200 };
    },
    async () => {},
  );
  assert.equal(status, 200);
  await assert.rejects(
    () =>
      waitForHealth(
        "https://vibesdk-lab.karant-test-egress-canary.workers.dev",
      ),
    /refusing health url/,
  );
});

test("the Vibe SDK workflow stays off the Dyad devbox", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview-vibesdk.yml", import.meta.url),
    "utf8",
  );
  const script = readFileSync(
    new URL("./vibesdk-preview.mjs", import.meta.url),
    "utf8",
  );
  const resources = readFileSync(
    new URL("./vibesdk.mjs", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /preview-vibesdk/);
  assert.match(workflow, /vibesdk-preview-pr-/);
  assert.match(workflow, /doppler-project: dyad/);
  assert.match(workflow, /doppler-config: preview/);
  assert.equal(workflow.includes("preview-devbox-wewebplus-ci"), false);
  assert.equal(workflow.includes("Wewebplus-ci"), false);
  assert.equal(workflow.includes("controller.mjs"), false);
  assert.equal(workflow.includes("DOPPLER_ADMIN_TOKEN"), false);
  assert.equal(workflow.includes("preview-bolt"), false);
  assert.equal(workflow.includes("preview-cloudflare"), false);
  assert.equal(script.includes("neon.mjs"), false);
  assert.equal(script.includes("controller.mjs"), false);
  assert.equal(script.includes("DOPPLER_ADMIN_TOKEN"), false);
  assert.equal(resources.includes("neon.mjs"), false);
  assert.equal(resources.includes("ensurePreviewBranch"), false);
});
