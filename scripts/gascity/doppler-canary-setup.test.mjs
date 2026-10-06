import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/doppler-canary-setup.yml", import.meta.url),
  "utf8",
);

test("the canary Doppler setup writes dyad/canary and does not print values", () => {
  assert.match(workflow, /cursor\/ecs-hitl-cutover-bbea/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/cursor\/ecs-hitl-cutover-bbea'/,
  );
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /slug": "canary"/);
  assert.match(workflow, /wewebplus-canary/);
  assert.match(workflow, /br-quiet-frog-b3l8isvn/);
  assert.match(workflow, /ep-muddy-sky-b31adt7z/);
  assert.match(workflow, /NOVNC_PASSWORD/);
  assert.match(workflow, /WEWEBPLUS_DATABASE_URL/);
  assert.doesNotMatch(workflow, /printenv/);
  assert.doesNotMatch(workflow, /echo "\$\{?WEWEBPLUS_DATABASE_URL/);
  assert.doesNotMatch(workflow, /echo "\$\{?DOPPLER_ADMIN_TOKEN/);
  assert.doesNotMatch(workflow, /gascity-server/);
  assert.doesNotMatch(workflow, /service_account_tokens/);
});
