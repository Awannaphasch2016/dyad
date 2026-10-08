import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redact } from "./vibesdk-project.mjs";
import {
  LAB_D1_NAME,
  LAB_GATEWAY_ID,
  LAB_PUBLIC_HOST,
  LAB_THINK_MODEL_ID,
  LAB_THINK_PROVIDER,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
  csrfTokenFromJar,
  d1CreateBody,
  findNamed,
  gatewayCreateBody,
  labConfigViolations,
  failureTail,
  labPassword,
  labWranglerConfig,
  optionalLabSecrets,
  shouldMask,
  takeOpenRouter,
  labWebsocketUrl,
  modelTurnOutcome,
  parseWorkersDevUrl,
  collectStaticWebAssets,
  commitHasAppClass,
  patchAppCreationLimit,
  patchPreviewPane,
  patchPreviewServing,
  patchStaticSiteDeploy,
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
  previewProbeDecision,
  promptOutcome,
  providerConfigBody,
  rowsOf,
  storeCookies,
} from "./vibesdk-lab.mjs";

const deployScript = readFileSync(
  new URL("./deploy-vibesdk-lab.mjs", import.meta.url),
  "utf8",
);

const thinkModel = `export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'Gemini 3.6 Flash',
	size: ModelSize.REGULAR,
	provider: 'google-ai-studio',
	creditCost: 2,
	contextSize: 1_048_576,
};
`;

test("the lab wrangler config has no production bindings", () => {
  const config = labWranglerConfig({
    accountId: "lab-account",
    databaseId: "11111111-1111-1111-1111-111111111111",
    kvId: "lab-kv",
  });
  assert.deepEqual(labConfigViolations(config), []);
  assert.equal(config.d1_databases[0].database_name, LAB_D1_NAME);
  assert.equal(config.vars.CLOUDFLARE_AI_GATEWAY, LAB_GATEWAY_ID);
  assert.equal(config.vars.CUSTOM_DOMAIN, LAB_PUBLIC_HOST);
  assert.equal(config.containers, undefined);
  assert.equal(config.routes, undefined);
  assert.throws(
    () =>
      labWranglerConfig({
        accountId: "lab-account",
        databaseId: PRODUCTION_DATABASE_ID,
        kvId: "lab-kv",
      }),
    /refusing production d1/,
  );
  assert.throws(
    () =>
      labWranglerConfig({
        accountId: "lab-account",
        databaseId: "11111111-1111-1111-1111-111111111111",
        kvId: PRODUCTION_KV_ID,
      }),
    /refusing production kv/,
  );
});

test("resource bodies use lab names", () => {
  assert.equal(gatewayCreateBody().id, "vibesdk-lab");
  assert.equal(gatewayCreateBody().cache_ttl, 0);
  assert.equal(d1CreateBody().name, "vibesdk-lab");
  assert.equal(providerConfigBody("test-secret").provider_slug, "anthropic");
  assert.equal(providerConfigBody("test-secret").alias, "default");
  const rows = rowsOf({
    result: [{ name: "vibesdk-db" }, { name: "vibesdk-lab", uuid: "lab-id" }],
  });
  assert.equal(findNamed(rows, "name", "vibesdk-lab").uuid, "lab-id");
  assert.equal(
    findNamed(
      rowsOf({ result: { buckets: [{ name: "other" }] } }),
      "name",
      "vibesdk-lab",
    ),
    null,
  );
});

test("the checkout patches leave Gemini and the sandbox export behind", () => {
  const patched = patchThinkModel(thinkModel);
  assert.match(patched, new RegExp(LAB_THINK_MODEL_ID.replaceAll(".", "\\.")));
  assert.match(patched, new RegExp(`provider: '${LAB_THINK_PROVIDER}'`));
  assert.match(patched, /directOverride: true/);
  assert.equal(patched.includes("gemini"), false);
  assert.equal(patched.includes("google-ai-studio"), false);
  assert.equal(patched.includes("provider: 'anthropic'"), false);
  assert.equal(patched.includes("anthropic/claude-sonnet-4-5"), false);
  const routing =
    patchThinkRouting(`const usesStoredKeys = !conf.defaultHeaders?.['cf-aig-authorization'];
		const headers: Record<string, string> = { ...(conf.defaultHeaders ?? {}) };
		if (gatewayToken && !headers['cf-aig-authorization']) {
			headers['cf-aig-authorization'] = \`Bearer \${gatewayToken}\`;
		}
		if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY) {
			baseURL = \`https://gateway.ai.cloudflare.com/v1/\${env.CLOUDFLARE_ACCOUNT_ID}/\${env.CLOUDFLARE_AI_GATEWAY}/compat\`;
		}
	async build(): Promise<void> {
		if (!this.isMVPGenerated()) {
			return;
		}
`);
  assert.match(routing, /directOpenRouter/);
  assert.match(routing, /await this\.configureThinkAgent\(\)/);
  assert.match(
    routing,
    /if \(!directOpenRouter && env\.CLOUDFLARE_ACCOUNT_ID && env\.CLOUDFLARE_AI_GATEWAY\)/,
  );
  assert.equal(
    routing.includes(
      "if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY)",
    ),
    false,
  );
  const entry =
    "export { UserAppSandboxService } from './services/sandbox/sandboxSdkClient';\nexport { CodeGeneratorAgent } from './agents/core/codingAgent';\n";
  const worker = patchWorkerExports(entry);
  assert.equal(worker.includes("UserAppSandboxService"), false);
  assert.match(worker, /CodeGeneratorAgent/);
  const limits = patchAppCreationLimit(`appCreation: {
		enabled: true,
		store: RateLimitStore.DURABLE_OBJECT,
		limit: 3,
		dailyLimit: 3,
		period: 24 * 60 * 60, // 24 hours
	},
	llmCalls: {
		enabled: true,`);
  assert.match(limits, /appCreation: \{\n\t\tenabled: false,/);
  assert.match(limits, /llmCalls: \{\n\t\tenabled: true,/);
  assert.throws(
    () => patchAppCreationLimit("appCreation: { enabled: true }"),
    /did not match/,
  );
});

test("deploy output and the smoke prompt stay free of secret values", () => {
  assert.equal(
    parseWorkersDevUrl(
      "Deployed vibesdk-lab triggers\n  https://vibesdk-lab.example.workers.dev\n",
    ),
    "https://vibesdk-lab.example.workers.dev",
  );
  const outcome = promptOutcome(
    `${JSON.stringify({ agentId: "agent-1", message: "Code generation started" })}\n${JSON.stringify({ error: { message: "rejected sk-ant-secretvalue" } })}\n`,
  );
  assert.equal(outcome.agent, "present");
  assert.equal(redact(outcome.error).includes("secretvalue"), false);
  assert.match(redact(outcome.error), /sk-ant-redacted/);
  const jar = storeCookies({}, [
    `csrf-token=${encodeURIComponent(JSON.stringify({ token: "abc", timestamp: 1 }))}; Path=/; HttpOnly`,
    "accessToken=jwt-value; Path=/; Secure",
  ]);
  assert.equal(csrfTokenFromJar(jar), "abc");
  assert.equal(jar.accessToken, "jwt-value");
  assert.match(labPassword("zzzzzzzz"), /^Aa1/);
  assert.equal(
    labWebsocketUrl(
      {
        websocketUrl:
          "wss://vibesdk-lab.example.workers.dev/api/agent/agent-1/ws",
      },
      "https://vibesdk-lab.example.workers.dev",
    ),
    "wss://vibesdk-lab.example.workers.dev/api/agent/agent-1/ws",
  );
  assert.equal(
    labWebsocketUrl(
      { websocketUrl: "wss://evil.example/api/agent/agent-1/ws" },
      "https://vibesdk-lab.example.workers.dev",
    ),
    "",
  );
  const turn = modelTurnOutcome([
    { type: "conversation_response", message: "", isStreaming: true },
    { type: "conversation_response", message: "pon", isDelta: true },
    { type: "conversation_response", message: "g", isDelta: true },
  ]);
  assert.equal(turn.reply, "present");
  assert.equal(turn.error, "");
  assert.equal(
    modelTurnOutcome([
      { type: "conversation_response", message: "pong", isStreaming: false },
    ]).reply,
    "pong",
  );
  assert.equal(
    modelTurnOutcome([
      {
        type: "error",
        error:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    ]).error.includes("Anthropic"),
    true,
  );
});

test("a normal website is stored and a finished preview failure stops", () => {
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
  assert.equal(
    commitHasAppClass({
      "index.html": "export class App",
    }),
    false,
  );
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

  const deploy =
    patchStaticSiteDeploy(`export async function buildBranchDeployment(
  ctx: DeployContext,
  branch: string
): Promise<BranchDeploymentBundle> {
  try {
    const assetsDir = wranglerCfg.assets?.directory?.replace(/^\\.?\\//, "").replace(/\\/$/, "")
    const result = await createWorker({ files, entryPoint: wranglerCfg.main })
  }
}
`);
  assert.match(deploy, /mainModule: "__vibesdk_static_site__"/);
  assert.match(deploy, /html_handling: "auto-trailing-slash"/);
  assert.match(deploy, /not_found_handling: "none"/);
  assert.match(deploy, /export class App/);
  assert.match(deploy, /createWorker/);
  assert.throws(
    () => patchStaticSiteDeploy("no deploy function"),
    /did not match/,
  );

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
  assert.match(serving, /__vibesdk_static_site__/);
  assert.match(serving, /Preview cannot show this page\./);
  assert.match(serving, /status: 404/);
  assert.match(serving, /Failed to load App class/);
  assert.match(serving, /if \(response\.body === null\) return response/);
  assert.match(serving, /new HTMLRewriter\(\)/);
  const rewriterAt = serving.indexOf("new HTMLRewriter()");
  const nullBodyAt = serving.indexOf("response.body === null");
  assert.equal(nullBodyAt < rewriterAt, true);

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
  assert.match(pane, /The preview is still starting\./);
  assert.equal(pane.includes("requestRedeploy"), false);
  assert.equal(pane.includes("describe the problem in chat"), false);
  assert.equal(pane.includes("Preview not ready yet"), false);
  assert.equal(pane.includes("REDEPLOY_AFTER_ATTEMPT"), false);
  assert.throws(() => patchPreviewPane("untouched"), /did not match/);
});

test("the deploy script does not copy dyad database urls or production routes", () => {
  assert.equal(deployScript.includes("connection_uri"), false);
  assert.equal(deployScript.includes("WEWEBPLUS_DATABASE_URL"), false);
  assert.equal(deployScript.includes("build.cloudflare.dev"), false);
  assert.equal(deployScript.includes("copy-vibesdk-references"), false);
  assert.match(deployScript, /::add-mask::/);
  assert.match(deployScript, /labConfigViolations/);
  assert.match(deployScript, /durable_objects=pricing_required/);
  assert.equal(deployScript.includes("GEMINI_API_KEY"), false);
  assert.match(deployScript, /OPENROUTER_API_KEY is not available/);
  assert.match(deployScript, /patchThinkRouting/);
  assert.match(deployScript, /patchAppCreationLimit/);
  assert.match(deployScript, /app_creation_limit=disabled/);
  assert.match(deployScript, /patchStaticSiteDeploy/);
  assert.match(deployScript, /patchPreviewServing/);
  assert.match(deployScript, /patchPreviewPane/);
  assert.match(deployScript, /static_preview=enabled/);
  assert.match(deployScript, /model reply absent/);
  assert.match(deployScript, /generate_all/);
  assert.deepEqual(optionalLabSecrets, ["OPENROUTER_API_KEY"]);
});

test("masking skips short values and private keys, and OpenRouter reads one name", () => {
  assert.equal(shouldMask("dev"), false);
  assert.equal(shouldMask("vibesdk"), false);
  assert.equal(
    shouldMask(
      "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    ),
    false,
  );
  assert.equal(shouldMask("sk-or-example-value-123456"), true);
  const payload = {
    secrets: {
      OPENROUTER_API_KEY: {
        raw: "sk-or-example-value-123456",
        computed: "sk-or-example-value-123456",
      },
      SOME_PRIVATE_KEY: {
        raw: "-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----",
      },
    },
  };
  const found = takeOpenRouter(payload);
  assert.equal(found.key, "sk-or-example-value-123456");
  assert.deepEqual(found.privateKeyNames, ["SOME_PRIVATE_KEY"]);
  assert.equal(payload.secrets.SOME_PRIVATE_KEY.raw, undefined);
  assert.equal(JSON.stringify(payload).includes("BEGIN RSA"), false);
  const tail = failureTail(
    "banner\n-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----\nUpload failed: binding DB\n",
  );
  assert.equal(tail.includes("secret"), false);
  assert.match(tail, /binding DB/);
  const buried = failureTail(
    [
      "✘ [ERROR] Durable Objects require a paid plan",
      ...Array.from({ length: 30 }, () => "env.VAR Environment Variable"),
    ].join("\n"),
  );
  assert.match(buried, /paid plan/);
});
