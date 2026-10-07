import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { redact } from "./vibesdk-project.mjs";
import {
  LAB_D1_NAME,
  LAB_GATEWAY_ID,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
  csrfTokenFromJar,
  d1CreateBody,
  findNamed,
  gatewayCreateBody,
  labConfigViolations,
  labPassword,
  labWranglerConfig,
  parseWorkersDevUrl,
  patchThinkModel,
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
  assert.match(patched, /anthropic\/claude-sonnet-4-5/);
  assert.equal(patched.includes("gemini"), false);
  assert.equal(patched.includes("google-ai-studio"), false);
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
});

test("the deploy script does not copy dyad database urls or production routes", () => {
  assert.equal(deployScript.includes("connection_uri"), false);
  assert.equal(deployScript.includes("WEWEBPLUS_DATABASE_URL"), false);
  assert.equal(deployScript.includes("build.cloudflare.dev"), false);
  assert.equal(deployScript.includes("copy-vibesdk-references"), false);
  assert.match(deployScript, /::add-mask::/);
  assert.match(deployScript, /labConfigViolations/);
  assert.equal(deployScript.includes("GEMINI_API_KEY"), false);
});
