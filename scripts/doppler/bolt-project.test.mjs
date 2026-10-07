import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cloudflareReferencePlan,
  configReport,
  githubEnvAssignment,
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
  assert.match(deploy, /export-bolt-preview-env\.mjs/);
  assert.equal(deploy.includes("secrets.CLOUDFLARE_API_TOKEN"), false);
  assert.equal(deploy.includes("secrets.CLOUDFLARE_ACCOUNT_ID"), false);
});

test("github env export accepts only the two Cloudflare names", () => {
  const assignment = githubEnvAssignment("CLOUDFLARE_API_TOKEN", "token-value");
  assert.match(
    assignment,
    /^CLOUDFLARE_API_TOKEN<<BOLT_CLOUDFLARE_API_TOKEN_EOF/,
  );
  assert.throws(() => githubEnvAssignment("WEWEBPLUS_DATABASE_URL", "x"));
  assert.throws(() => githubEnvAssignment("CLOUDFLARE_API_TOKEN", ""));
});
