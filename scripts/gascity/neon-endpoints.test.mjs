import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/neon-endpoints.yml", import.meta.url),
  "utf8",
);

test("the Neon endpoint map prints branch ids and host labels only", () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /cursor\/ecs-hitl-cutover-bbea/);
  assert.match(workflow, /\.github\/workflows\/neon-endpoints\.yml/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/cursor\/ecs-hitl-cutover-bbea'/,
  );
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(
    workflow,
    /doppler-identity-id: 18edf96d-89e6-40f6-87aa-073c11a02e14/,
  );
  assert.match(workflow, /doppler-project: dyad/);
  assert.match(workflow, /doppler-config: preview/);
  assert.match(workflow, /PROJECT: mute-credit-71067312/);
  assert.match(workflow, /branch_id/);
  assert.doesNotMatch(workflow, /printenv/);
  assert.doesNotMatch(workflow, /connection_uri/);
  assert.doesNotMatch(workflow, /WEWEBPLUS_DATABASE_URL/);
  assert.doesNotMatch(workflow, /gascity-server/);
});
