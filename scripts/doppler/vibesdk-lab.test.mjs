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
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
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
`);
  assert.match(routing, /directOpenRouter/);
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
  assert.match(deployScript, /model reply absent/);
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
