import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/doppler-prd-check.yml", import.meta.url),
  "utf8",
);

test("the production Doppler check reads dyad/prd from main and does not print values", () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /doppler-project: dyad/);
  assert.match(workflow, /doppler-config: prd/);
  assert.match(
    workflow,
    /doppler-identity-id: 5a844bf1-8def-47f4-8ae1-9520f7bf109b/,
  );
  assert.match(workflow, /NOVNC_PASSWORD/);
  assert.match(workflow, /GAS_CITY_HOST_BRIDGE_TOKEN/);
  assert.match(workflow, /WEWEBPLUS_DATABASE_URL/);
  assert.match(workflow, /WEWEBPLUS_SECRETS_KEY/);
  assert.doesNotMatch(workflow, /printenv/);
  assert.doesNotMatch(workflow, /echo "\$\{?WEWEBPLUS_DATABASE_URL/);
  assert.doesNotMatch(workflow, /gascity-server/);
});
