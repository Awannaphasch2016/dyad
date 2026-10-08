import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deletePreviewResources,
  ensurePreviewResources,
  previewWasDeleted,
} from "./vibesdk-cloudflare.mjs";
import {
  announceRemoval,
  cloudflareCreds,
  commandFromEnv,
  decideFromEvent,
  provisionPreview,
  removalCommentAction,
  upsertPreviewComment,
  waitForHealth,
} from "./vibesdk-preview.mjs";
import {
  membershipReady,
  patchAuthRoutes,
  patchLoginModal,
  sharedSession,
} from "./vibesdk-shared-auth.mjs";
import {
  BUILDER_NOTE,
  LAB_D1_ID,
  PREVIEW_COMMENT_MARKER,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
  collectStaticWebAssets,
  commitHasAppClass,
  patchAppCreationLimit,
  patchPreviewPane,
  patchPreviewServing,
  patchStaticSiteDeploy,
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
  previewCommentBody,
  previewProbeDecision,
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
  assert.equal(config.vars.ENABLE_EMAIL_AUTH, "false");
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
  const cleanup = previewCommentBody("cleanup-failed");
  assert.match(cleanup, /cleanup did not finish/);
  assert.equal(cleanup.includes("was not updated"), false);
  assert.match(
    previewCommentBody("cleanup-failed", names),
    new RegExp(names.url.replaceAll(".", "\\.")),
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
  assert.equal(previewWasDeleted(second), false);
  assert.equal(
    calls.some((call) => call.startsWith("DELETE")),
    false,
  );
  assert.equal(
    calls.some((call) => /rate-?limit/i.test(call)),
    false,
  );
});

test("an existing worker is force-deleted once", async () => {
  const calls = [];
  const result = await deletePreviewResources({
    accountId,
    pr: "70",
    request: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (method === "GET" && path.includes("/workers/scripts/")) {
        return { status: 200, payload: { success: true, result: {} } };
      }
      if (method === "DELETE" && path.includes("/workers/scripts/")) {
        return { status: 200, payload: { success: true } };
      }
      return { status: 200, payload: { success: true, result: [] } };
    },
  });
  assert.equal(result.worker.deleted, true);
  assert.equal(previewWasDeleted(result), true);
  const deletes = calls.filter((call) => call.startsWith("DELETE"));
  assert.deepEqual(deletes, [
    `DELETE /accounts/${accountId}/workers/scripts/vibesdk-pr-70?force=true`,
  ]);
});

test("a missing worker still deletes a remaining database", async () => {
  const calls = [];
  const result = await deletePreviewResources({
    accountId,
    pr: "70",
    request: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (path.includes("/workers/scripts/")) {
        return { status: 404, payload: {} };
      }
      if (method === "GET" && path.includes("/d1/")) {
        return {
          status: 200,
          payload: {
            success: true,
            result: [{ name: "vibesdk-pr-70", uuid: databaseId }],
          },
        };
      }
      if (method === "DELETE" && path.endsWith(`/d1/database/${databaseId}`)) {
        return { status: 412, payload: { success: false } };
      }
      if (method === "DELETE" && path.includes("force=true")) {
        return { status: 200, payload: { success: true } };
      }
      return { status: 200, payload: { success: true, result: [] } };
    },
  });
  assert.equal(result.worker.deleted, false);
  assert.equal(result.d1.deleted, true);
  assert.equal(previewWasDeleted(result), true);
  assert.equal(calls.filter((call) => call.startsWith("DELETE ")).length, 2);
  assert.equal(
    calls.some((call) =>
      call.includes(`/d1/database/${databaseId}?force=true`),
    ),
    true,
  );
  assert.equal(
    calls.some((call) => call.startsWith("DELETE") && !call.includes("force=")),
    true,
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

test("the shared sign-in keeps one Wewebplus role and hides the email form", () => {
  assert.equal(membershipReady("developer:1,project-manager:1"), true);
  assert.equal(membershipReady("developer:1"), false);
  assert.deepEqual(
    sharedSession({
      userId: "user_1",
      memberships: [{ role_id: "project-manager", organization: "Wewebplus" }],
    }),
    {
      signedIn: true,
      organization: "Wewebplus",
      role: "Project Manager",
      userId: "user_1",
    },
  );
  assert.equal(
    sharedSession({
      userId: "user_1",
      memberships: [
        { role_id: "project-manager" },
        { role_id: "developer" },
      ],
    }).role,
    null,
  );
  const routes = patchAuthRoutes(
    "import { AuthController } from '../controllers/auth/controller';\n    authRouter.post('/register', setAuthLevel(AuthConfig.public), adaptController(AuthController, AuthController.register));\n",
  );
  assert.match(routes, /\/api\/auth\/shared|authRouter.post\('\/shared'/);
  assert.throws(() => patchAuthRoutes("no routes"), /missed auth import/);
  const modal = patchLoginModal(
    [
      "export function LoginModal",
      "\tconst hasEmailAuth = emailAuthEnabled && !!onEmailLogin;",
      "\tconst hasRegistration = emailAuthEnabled && !!onRegister;",
      "\tconst showGitHub = authProviders?.github && hasOAuth;",
      "\tconst showGoogle = authProviders?.google && hasOAuth;",
      "\tconst showCloudflare = authProviders?.cloudflare && hasOAuth;",
      "\t\t\t\t<div className={cn('p-6 space-y-4 pt-6')}>",
      "\t\t\t\t\t{/* GitHub */}",
    ].join("\n"),
  );
  assert.match(modal, /Sign in/);
  assert.match(modal, /&& false &&/);
});

test("cloudflare credentials use CLOUDFLARE_API_TOKEN", () => {
  const preferred = cloudflareCreds(
    {
      CLOUDFLARE_API_TOKEN: "a".repeat(40),
      CLOUDFLARE_API_TOKEN_: "b".repeat(40),
      CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
      OPENROUTER_API_KEY: `sk-or-${"k".repeat(24)}`,
    },
    { openRouter: true },
  );
  assert.equal(preferred.tokenName, "CLOUDFLARE_API_TOKEN");
  assert.equal(preferred.token, "a".repeat(40));
  const fallback = cloudflareCreds({
    CLOUDFLARE_API_TOKEN_: "b".repeat(40),
    CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
  });
  assert.equal(fallback.tokenName, "CLOUDFLARE_API_TOKEN_");
  assert.equal(fallback.token, "b".repeat(40));
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
  assert.equal(
    commandFromEnv({ EVENT_NAME: "workflow_dispatch", PR: "70" }),
    "destroy",
  );
  assert.throws(
    () => commandFromEnv({ EVENT_NAME: "workflow_dispatch", PR: "nope" }),
    /Pull request number is required/,
  );
  assert.equal(
    commandFromEnv({
      EVENT_NAME: "pull_request",
      ACTION: "closed",
      CLOSED: "true",
      LABELS: "",
    }),
    "destroy",
  );
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
  assert.match(workflow, /doppler-project: vibesdk/);
  assert.match(workflow, /doppler-config: dev/);
  assert.equal(workflow.includes("doppler-project: bolt"), false);
  assert.equal(workflow.includes("doppler-project: forma"), false);
  assert.equal(workflow.includes("preview-devbox-wewebplus-ci"), false);
  assert.equal(workflow.includes("Wewebplus-ci"), false);
  assert.equal(workflow.includes("controller.mjs"), false);
  assert.equal(workflow.includes("DOPPLER_ADMIN_TOKEN"), false);
  assert.equal(workflow.includes("preview-bolt"), false);
  assert.equal(workflow.includes("preview-cloudflare"), false);
  assert.equal(script.includes("neon.mjs"), false);
  assert.equal(script.includes("controller.mjs"), false);
  assert.equal(script.includes("DOPPLER_ADMIN_TOKEN"), false);
  assert.match(script, /patchAppCreationLimit/);
  assert.match(script, /app_creation_limit=disabled/);
  assert.match(script, /patchStaticSiteDeploy/);
  assert.match(script, /patchPreviewServing/);
  assert.match(script, /patchPreviewPane/);
  assert.match(script, /static_preview=enabled/);
  assert.equal(resources.includes("neon.mjs"), false);
  assert.equal(resources.includes("ensurePreviewBranch"), false);
  const dyadPreview = readFileSync(
    new URL("../../.github/workflows/preview.yml", import.meta.url),
    "utf8",
  );
  assert.equal(dyadPreview.includes("wrangler"), false);
  assert.equal(dyadPreview.includes("vibesdk"), false);
  assert.equal(dyadPreview.includes("patchStaticSiteDeploy"), false);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /description: Pull request number/);
  assert.equal(workflow.includes("schedule:"), false);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /cleanup-failed/);
  assert.match(workflow, /DELETED:/);
  const destroy = workflow.split("\n  destroy:")[1];
  assert.equal(destroy.includes("pull_request.head.sha"), false);
  assert.match(destroy, /kind removed/);
});

test("a removal comment stays quiet unless a preview existed", async () => {
  assert.equal(removalCommentAction({ deleted: true }), "removed");
  assert.equal(
    removalCommentAction({
      deleted: false,
      existingBody: "cleanup did not finish",
    }),
    "removed",
  );
  assert.equal(
    removalCommentAction({ deleted: false, existingBody: "" }),
    "silent",
  );
  const calls = [];
  const silent = await announceRemoval({
    repo: "Awannaphasch2016/dyad",
    pr: "12",
    token: "github-token",
    deleted: false,
    fetchImpl: async (url, options = {}) => {
      calls.push(`${options.method || "GET"} ${url}`);
      return jsonResponse(200, []);
    },
  });
  assert.equal(silent, "silent");
  assert.equal(
    calls.some((call) => call.startsWith("POST") || call.startsWith("PATCH")),
    false,
  );
  const comments = [
    {
      id: 4,
      body: `${PREVIEW_COMMENT_MARKER}\nVibe SDK preview cleanup did not finish.`,
    },
  ];
  const corrected = await announceRemoval({
    repo: "Awannaphasch2016/dyad",
    pr: "12",
    token: "github-token",
    deleted: false,
    fetchImpl: async (url, options = {}) => {
      if (!options.method) return jsonResponse(200, comments);
      comments[0].body = JSON.parse(options.body).body;
      return jsonResponse(200, comments[0]);
    },
  });
  assert.equal(corrected, "removed");
  assert.match(comments[0].body, /Removed Vibe SDK preview/);
});

test("a normal website is stored and a finished preview failure stops", () => {
  assert.equal(
    patchAppCreationLimit("appCreation: {\n\t\tenabled: true,").includes(
      "enabled: false",
    ),
    true,
  );
  assert.equal(
    commitHasAppClass({
      "index.html": "<h1>Bakery</h1>",
      "src/app.ts": "export class Appliance {}",
    }),
    false,
  );
  assert.equal(
    commitHasAppClass({
      "src/app.ts": "export class App extends DurableObject {}",
    }),
    true,
  );
  assert.equal(commitHasAppClass({ "index.html": "export class App" }), false);
  const assets = collectStaticWebAssets({
    "index.html": "<h1>Bakery</h1>",
    "styles/site.css": "body{}",
    "photo.png": "png",
    ".env": "SECRET=1",
    ".git/config": "secret",
    "node_modules/left-pad/index.js": "nope",
    "wrangler.jsonc": "{}",
    "src/app.ts": "export const x = 1",
  });
  assert.deepEqual(assets, {
    "/index.html": "<h1>Bakery</h1>",
    "/styles/site.css": "body{}",
    "/photo.png": "png",
  });
  assert.equal(previewProbeDecision(200), "ready");
  assert.equal(previewProbeDecision(404), "terminal");
  assert.equal(previewProbeDecision(503), "terminal");
  assert.equal(previewProbeDecision(502), "retry");

  const deploy = patchStaticSiteDeploy(
    `export async function buildBranchDeployment(
  ctx: DeployContext,
  branch: string
): Promise<BranchDeploymentBundle> {
  try {
    const assetsDir = wranglerCfg.assets?.directory?.replace(/^\\.?\\//, "").replace(/\\/$/, "")
    const result = await createWorker({ files, entryPoint: wranglerCfg.main })
  }
}
`,
  );
  assert.match(deploy, /mainModule: "__vibesdk_static_site__"/);
  assert.match(deploy, /html_handling: "auto-trailing-slash"/);
  assert.match(deploy, /not_found_handling: "none"/);
  assert.match(deploy, /export class App/);
  assert.match(deploy, /createWorker/);

  const serving = patchPreviewServing(`    let appClass: DurableObjectClass
    try {
      appClass = this.loadAppClass(dep)
    } catch (e) {
      return new Response("Failed to load App class", { status: 500 })
    }
  if (!ct.includes("text/html")) return response

  // Use HTMLRewriter to prefix root-relative src/href/action attributes
  return new HTMLRewriter()
`);
  assert.match(serving, /Preview cannot show this page\./);
  assert.match(serving, /status: 404/);
  assert.match(serving, /Failed to load App class/);
  assert.match(serving, /if \(response\.body === null\) return response/);
  assert.equal(
    serving.indexOf("response.body === null") <
      serving.indexOf("new HTMLRewriter()"),
    true,
  );

  const pane = patchPreviewPane(`const MAX_RETRIES = 10;
const REDEPLOY_AFTER_ATTEMPT = 8;
		const testAvailability = useCallback(async (url: string): Promise<'sandbox' | 'dispatcher' | null> => {
				if (!response.ok) {
					console.log('Preview not ready (status:', response.status, ')');
					return null;
				}
			const previewType = await testAvailability(url);

			if (previewType) {
				console.log(\`Preview not ready. Retrying in \${Math.ceil(delay / 1000)}s (attempt \${nextAttempt}/\${MAX_RETRIES})\`);

				// Auto-redeploy after 3 failed attempts
				if (nextAttempt === REDEPLOY_AFTER_ATTEMPT) {
					requestRedeploy();
				}

				// Schedule next retry
		}, [testAvailability, requestScreenshot, requestRedeploy]);
		/**
		 * Request automatic redeployment via WebSocket
		 */
		const requestRedeploy = useCallback(() => {
			if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
				console.warn('Cannot request redeploy: WebSocket not connected');
				return;
			}

			if (hasRequestedRedeployRef.current) {
				console.log('Redeploy already requested, skipping duplicate request');
				return;
			}

			console.log('Requesting automatic preview redeployment');

			try {
				webSocket.send(JSON.stringify({
					type: 'preview',
				}));
				hasRequestedRedeployRef.current = true;
			} catch (error) {
				console.error('Failed to send redeploy request:', error);
			}
		}, [webSocket]);

			const delay = getRetryDelay(loadState.attempt - 1);
			const delaySeconds = Math.ceil(delay / 1000);

			return (
						<RefreshCw className="size-8 text-kumo-brand animate-spin mx-auto mb-4" />
						<h3 className="text-lg font-medium text-text-primary mb-2">
							Loading Preview
						</h3>
						<p className="text-text-primary/70 text-sm mb-4">
							{loadState.attempt === 0
								? 'Checking if your deployed preview is ready...'
								: \`Preview not ready yet. Retrying in \${delaySeconds}s... (attempt \${loadState.attempt}/\${MAX_RETRIES})\`
							}
						</p>
						{loadState.attempt >= REDEPLOY_AFTER_ATTEMPT && (
							<p className="text-xs text-kumo-brand/70">
								Auto-redeployment triggered to refresh the preview
							</p>
						)}
						<div className="text-xs text-text-primary/50 mt-2">
							Preview URLs may take a moment to become available after deployment
						</div>
					<h3 className="text-lg font-medium text-text-primary mb-2">
						Preview Not Available
					</h3>
					<p className="text-text-primary/70 text-sm mb-6">
						{loadState.errorMessage || 'The preview failed to load after multiple attempts.'}
					</p>
						<p className="text-xs text-text-primary/60">
							If the issue persists, please describe the problem in chat so I can help diagnose and fix it.
						</p>
`);
  assert.match(pane, /return 'terminal'/);
  assert.match(pane, /Preview cannot show this snapshot\./);
  assert.match(pane, /Opening preview/);
  assert.equal(pane.includes("requestRedeploy"), false);
  assert.equal(pane.includes("describe the problem in chat"), false);
  assert.equal(pane.includes("Preview not ready yet"), false);
});
