import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEST_CONFIG,
  DEST_PROJECT,
  DYAD_PROJECT,
  SECRET_NAME,
  SOURCE_PROJECT,
  openRouterShape,
  planOpenRouterCopy,
  referenceBody,
  selectOpenRouterSecret,
  uploadBody,
} from "./forma-openrouter-doppler.mjs";

test("the workflow copies OpenRouter from vibesdk into forma dev", () => {
  const workflow = readFileSync(
    new URL(
      "../../.github/workflows/forma-openrouter-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const script = readFileSync(
    new URL("./forma-openrouter-doppler.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(SOURCE_PROJECT, "vibesdk");
  assert.equal(DEST_PROJECT, "forma");
  assert.equal(DEST_CONFIG, "dev");
  assert.equal(SECRET_NAME, "OPENROUTER_API_KEY");
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/cursor\/forma-openrouter-doppler-5014'/,
  );
  assert.equal(workflow.includes("dyad/prd"), false);
  assert.equal(script.includes("dyad/prd"), false);
  assert.equal(workflow.includes("set -x"), false);
});

test("only a resolved OpenRouter key is selected", () => {
  const ready = selectOpenRouterSecret(
    { dev: ["OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN"] },
    { dev: { OPENROUTER_API_KEY: "sk-or-example" } },
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.config, "dev");
  assert.deepEqual(Object.keys(ready.secrets), ["OPENROUTER_API_KEY"]);

  const openai = selectOpenRouterSecret(
    { dev: ["OPENROUTER_API_KEY"] },
    { dev: { OPENROUTER_API_KEY: "sk-openai-example" } },
  );
  assert.equal(openai.status, "openai");
  assert.equal(openai.secrets, null);

  const unresolved = selectOpenRouterSecret(
    { preview: ["OPENROUTER_API_KEY"] },
    { preview: { OPENROUTER_API_KEY: "${dyad.preview.OPENROUTER_API_KEY}" } },
  );
  assert.equal(unresolved.status, "unresolved");
  assert.equal(openRouterShape(""), "absent");
});

test("a missing vibesdk key uses the dyad preview reference", () => {
  const planned = planOpenRouterCopy({
    vibesdkNamesByConfig: { dev: ["CLOUDFLARE_API_TOKEN"] },
    vibesdkValuesByConfig: {},
    dyadNamesByConfig: {
      preview: ["OPENROUTER_API_KEY"],
      prd: ["OPENROUTER_API_KEY"],
    },
    dyadValuesByConfig: {
      preview: { OPENROUTER_API_KEY: "sk-or-example" },
      prd: { OPENROUTER_API_KEY: "sk-or-production" },
    },
  });
  assert.equal(planned.status, "ready");
  assert.equal(planned.sourceProject, "vibesdk");
  assert.equal(planned.sourceConfig, "dev");
  assert.equal(planned.upstream.project, DYAD_PROJECT);
  assert.equal(planned.upstream.config, "preview");
  assert.equal(
    planned.upstream.reference,
    "${dyad.preview.OPENROUTER_API_KEY}",
  );
  assert.equal(planned.upstream.reference.includes("prd"), false);
  const body = referenceBody("vibesdk", "dev", planned.upstream.reference);
  assert.deepEqual(Object.keys(body.secrets), ["OPENROUTER_API_KEY"]);
  assert.throws(
    () => referenceBody("vibesdk", "prd", planned.upstream.reference),
    /Refusing a production config/,
  );
});

test("an OpenAI-shaped vibesdk value is not replaced from dyad", () => {
  const planned = planOpenRouterCopy({
    vibesdkNamesByConfig: { dev: ["OPENROUTER_API_KEY"] },
    vibesdkValuesByConfig: { dev: { OPENROUTER_API_KEY: "sk-openai-example" } },
    dyadNamesByConfig: { preview: ["OPENROUTER_API_KEY"] },
    dyadValuesByConfig: { preview: { OPENROUTER_API_KEY: "sk-or-example" } },
  });
  assert.equal(planned.status, "openai");
  assert.equal(planned.secrets, null);
  assert.equal(planned.upstream, null);
});

test("upload refuses every OpenAI name", () => {
  const body = uploadBody({ OPENROUTER_API_KEY: "sk-or-example" });
  assert.equal(body.project, "forma");
  assert.equal(body.config, "dev");
  assert.throws(
    () => uploadBody({ OPENAI_API_KEY: "sk-example" }),
    /Refusing to upload/,
  );
  assert.throws(
    () =>
      uploadBody({
        OPENROUTER_API_KEY: "sk-or-example",
        OPENAI_EXECUTOR_API_KEY: "sk-example",
      }),
    /Refusing to upload/,
  );
});
