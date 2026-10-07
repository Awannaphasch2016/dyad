import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  absentAutoKeys,
  assertModelKeyCopy,
  autoKeysAfterCopy,
  autoModelKeyNames,
  chooseDevConfig,
  chooseModelKeySource,
  modelKeysToCopy,
} from "./model-keys.mjs";

test("non-empty model keys are copied and the database URL is not", () => {
  const copy = modelKeysToCopy({
    OPENAI_API_KEY: "sk-test-value",
    ANTHROPIC_API_KEY: "   ",
    GEMINI_API_KEY: "gemini-value",
    OPENROUTER_API_KEY: "",
    AWS_BEARER_TOKEN_BEDROCK: "bearer-value",
    WEWEBPLUS_DATABASE_URL: "postgres://dev-database",
    VERCEL_TOKEN: "edge-token",
  });
  assert.deepEqual(Object.keys(copy).sort(), [
    "AWS_BEARER_TOKEN_BEDROCK",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
  ]);
  assert.equal(Object.hasOwn(copy, "WEWEBPLUS_DATABASE_URL"), false);
  assert.equal(Object.hasOwn(copy, "VERCEL_TOKEN"), false);
  assert.deepEqual(absentAutoKeys(copy), [
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
  ]);
});

test("a canary key already present still counts when dev is empty", () => {
  assert.deepEqual(absentAutoKeys({}), autoModelKeyNames);
  assert.deepEqual(
    autoKeysAfterCopy({}, { OPENAI_API_KEY: "already-present" }),
    ["OPENAI_API_KEY"],
  );
  assert.deepEqual(modelKeysToCopy({}), {});
});

test("the dev config is chosen without using production", () => {
  assert.equal(
    chooseDevConfig([
      { name: "prd", environment: "prd", root: true },
      { name: "canary", environment: "canary", root: true },
      { name: "dev", environment: "dev", root: true },
    ]),
    "dev",
  );
  assert.equal(
    chooseDevConfig([
      { name: "prd", environment: "prd", root: true },
      { name: "dev_personal", environment: "dev", root: true },
      { name: "preview", environment: "preview", root: true },
    ]),
    "dev_personal",
  );
  assert.equal(
    chooseDevConfig([
      { name: "prd", environment: "prd", root: true },
      { name: "preview", environment: "preview", root: true },
    ]),
    "",
  );
  assert.equal(
    chooseDevConfig([
      { name: "dev_a", environment: "dev", root: true },
      { name: "dev_b", environment: "dev", root: false },
    ]),
    "dev_a",
  );
  assert.equal(
    chooseDevConfig([
      { name: "dev_a", environment: "dev", root: true },
      { name: "dev_b", environment: "dev", root: true },
    ]),
    "",
  );
});

test("preview supplies keys only when no dev config exists", () => {
  const dyadOnly = [
    {
      name: "dyad",
      configs: [
        { name: "preview", environment: "preview", root: true },
        { name: "prd", environment: "prd", root: true },
        { name: "canary", environment: "canary", root: true },
      ],
    },
  ];
  assert.deepEqual(chooseModelKeySource(dyadOnly), {
    project: "dyad",
    config: "preview",
    fallback: true,
  });
  assert.deepEqual(
    chooseModelKeySource([
      ...dyadOnly,
      {
        name: "dyad-labs",
        configs: [{ name: "dev", environment: "dev", root: true }],
      },
    ]),
    { project: "dyad-labs", config: "dev", fallback: false },
  );
  assert.equal(
    chooseModelKeySource([
      {
        name: "dyad",
        configs: [{ name: "prd", environment: "prd", root: true }],
      },
    ]),
    null,
  );
});

test("a database URL in the copy is refused", () => {
  assert.throws(
    () => assertModelKeyCopy({ WEWEBPLUS_DATABASE_URL: "postgres://nope" }),
    /database URL/,
  );
});

test("the canary deploy copies model keys before it fetches canary", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/canary-verify.yml", import.meta.url),
    "utf8",
  );
  const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
  const copyAt = deploy.indexOf(
    "node scripts/gascity/copy-canary-model-keys.mjs",
  );
  const fetchAt = deploy.indexOf("doppler-config: canary");
  assert.ok(copyAt > 0);
  assert.ok(fetchAt > copyAt);
  assert.match(deploy, /DOPPLER_ADMIN_TOKEN/);
});

test("register stores model keys only when the value is non-empty", () => {
  const register = readFileSync(
    new URL("../../deploy/canary/register.sh", import.meta.url),
    "utf8",
  );
  for (const name of [...autoModelKeyNames, "AWS_BEARER_TOKEN_BEDROCK"]) {
    assert.match(register, new RegExp(`put_optional_secret ${name} `));
    assert.equal(register.includes(`echo "$${name}"`), false);
    assert.equal(register.includes(`echo $${name}`), false);
  }
  assert.match(register, /if \[\[ -n "\$value" \]\]/);
});
