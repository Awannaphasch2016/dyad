import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  patchBrowserPolyfills,
  patchChatReady,
} from "./patch-bolt-polyfills.mjs";
import {
  chooseOpenRouterSource,
  cloudflareReferencePlan,
  configReport,
  githubEnvAssignment,
  isProductionConfig,
  openRouterReferencePlan,
  previewEnvironmentBody,
  previewInheritsBody,
  prdInheritsBody,
  takeSecretNames,
} from "./bolt-project.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/bolt-doppler-setup.yml", import.meta.url),
  "utf8",
);

test("cloudflare references point at vibesdk dev", () => {
  const plan = cloudflareReferencePlan([
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "ANTHROPIC_API_KEY",
  ]);
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID}",
  );
  assert.equal(plan.secrets.ANTHROPIC_API_KEY, undefined);
});

test("cloudflare references fall back to the suffixed dyad names", () => {
  const plan = cloudflareReferencePlan([
    "CLOUDFLARE_API_TOKEN_",
    "CLOUDFLARE_ACCOUNT_ID_",
  ]);
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN_}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID_}",
  );
});

test("an upstream root replaces a chained vibesdk reference", () => {
  const plan = cloudflareReferencePlan(
    ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    {
      CLOUDFLARE_ACCOUNT_ID: "${forma.dev.CLOUDFLARE_ACCOUNT_ID}",
    },
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${forma.dev.CLOUDFLARE_ACCOUNT_ID}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN}",
  );
});

test("a missing cloudflare name is reported and not invented", () => {
  const plan = cloudflareReferencePlan(["CLOUDFLARE_API_TOKEN"]);
  assert.deepEqual(plan.missing, ["CLOUDFLARE_ACCOUNT_ID"]);
  assert.equal(plan.secrets.CLOUDFLARE_ACCOUNT_ID, undefined);
});

test("preview is its own environment so the config name is preview", () => {
  assert.equal(previewEnvironmentBody().slug, "preview");
});

test("preview inherits bolt dev and prd inherits nothing", () => {
  assert.deepEqual(previewInheritsBody().inherits, [
    { project: "bolt", config: "dev" },
  ]);
  assert.deepEqual(prdInheritsBody().inherits, []);
});

test("secret name listing drops raw values", () => {
  const payload = {
    secrets: {
      CLOUDFLARE_API_TOKEN: { raw: "secret-value", computed: "secret-value" },
    },
  };
  assert.deepEqual(takeSecretNames(payload), ["CLOUDFLARE_API_TOKEN"]);
  assert.equal(payload.secrets.CLOUDFLARE_API_TOKEN.raw, undefined);
  assert.equal(payload.secrets.CLOUDFLARE_API_TOKEN.computed, undefined);
});

test("config report prints inheritance labels", () => {
  assert.deepEqual(
    configReport([
      { name: "preview", inherits: [{ project: "bolt", config: "dev" }] },
      { name: "prd", inherits: [] },
    ]),
    ["config=preview inherits=bolt.dev", "config=prd inherits=none"],
  );
});

test("the setup workflow uses the Doppler admin token and stays off main", () => {
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /cursor\/bolt-doppler-55d6/);
  assert.equal(workflow.includes("doppler-project: dyad"), false);
  assert.equal(workflow.includes("config: prd"), false);
});

test("the preview job reads Doppler and does not store Cloudflare secrets on bolt", () => {
  const deploy = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(deploy, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(deploy, /ensure-bolt-project\.mjs/);
  assert.match(deploy, /export-bolt-preview-env\.mjs/);
  assert.match(
    deploy,
    /wrangler secret put OPEN_ROUTER_API_KEY --name bolt-walkthrough-55d6/,
  );
  assert.equal(deploy.includes("secrets.CLOUDFLARE_API_TOKEN"), false);
  assert.equal(deploy.includes("secrets.CLOUDFLARE_ACCOUNT_ID"), false);
  assert.equal(deploy.includes('echo "$OPEN_ROUTER_API_KEY"'), false);
});

test("the chat restore effect no longer reads an unbound ready", () => {
  const source = [
    "factoryRunToRestore(ready, chatId.get(), restoredChatId.current, chatMetadata.get());",
    "}, [ready, initialMessages]);",
  ].join("\n");
  const patched = patchChatReady(source);
  assert.match(patched, /factoryRunToRestore\(true,/);
  assert.match(patched, /\}, \[initialMessages\]\);/);
  assert.equal(patched.includes("[ready, initialMessages]"), false);
  assert.equal(patchChatReady(patched), patched);
});

test("the polyfill patch skips the rolldown runtime", () => {
  const source =
    "transform(code: string, id: string) {\n      return null;\n    }";
  const patched = patchBrowserPolyfills(source);
  assert.match(patched, /id\.includes\("rolldown"\)/);
  assert.equal(patchBrowserPolyfills(patched), patched);
  assert.throws(() => patchBrowserPolyfills("no transform here"));
});

test("github env export accepts Cloudflare names and the OpenRouter key", () => {
  const assignment = githubEnvAssignment("CLOUDFLARE_API_TOKEN", "token-value");
  assert.match(
    assignment,
    /^CLOUDFLARE_API_TOKEN<<BOLT_CLOUDFLARE_API_TOKEN_EOF/,
  );
  const openRouter = githubEnvAssignment("OPEN_ROUTER_API_KEY", "sk-or-test");
  assert.match(
    openRouter,
    /^OPEN_ROUTER_API_KEY<<BOLT_OPEN_ROUTER_API_KEY_EOF/,
  );
  assert.throws(() => githubEnvAssignment("WEWEBPLUS_DATABASE_URL", "x"));
  assert.throws(() => githubEnvAssignment("OPENROUTER_API_KEY", "x"));
  assert.throws(() => githubEnvAssignment("CLOUDFLARE_API_TOKEN", ""));
});

test("the OpenRouter reference uses bolt's env name", () => {
  const plan = openRouterReferencePlan(
    { project: "dyad", config: "dev", name: "OPENROUTER_API_KEY" },
    "${dyad.dev.OPENROUTER_API_KEY}",
  );
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.secrets.OPEN_ROUTER_API_KEY,
    "${dyad.dev.OPENROUTER_API_KEY}",
  );
});

test("a missing OpenRouter key is reported and not invented", () => {
  const plan = openRouterReferencePlan(null);
  assert.deepEqual(plan.missing, ["OPEN_ROUTER_API_KEY"]);
  assert.equal(plan.secrets.OPEN_ROUTER_API_KEY, undefined);
});

test("OpenRouter source prefers the first non-production name", () => {
  assert.equal(isProductionConfig("prd"), true);
  assert.equal(isProductionConfig("production"), true);
  assert.equal(isProductionConfig("preview"), false);
  assert.equal(isProductionConfig("product"), false);
  const found = chooseOpenRouterSource([
    { project: "bolt", config: "dev", names: ["OPEN_ROUTER_API_KEY"] },
    { project: "dyad", config: "prd", names: ["OPENROUTER_API_KEY"] },
    { project: "vibesdk", config: "dev", names: ["CLOUDFLARE_API_TOKEN"] },
    { project: "dyad", config: "dev", names: ["OPENROUTER_API_KEY"] },
    {
      project: "forma",
      config: "dev",
      names: ["OPEN_ROUTER_API_KEY"],
    },
  ]);
  assert.deepEqual(found, {
    project: "dyad",
    config: "dev",
    name: "OPENROUTER_API_KEY",
  });
});
