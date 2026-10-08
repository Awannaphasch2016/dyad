import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = readFileSync(
  new URL("./doppler_oidc.py", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/probe-harness-oidc.yml", import.meta.url),
  "utf8",
);

test("the OIDC probe does not use a wildcard or print a database URL", () => {
  assert.equal(script.includes('claims_type": "wildcard"'), false);
  assert.equal(script.includes("claims_type=wildcard"), false);
  assert.match(script, /ep-young-wave-b3cwe0rz-pooler/);
  assert.equal(script.includes("13.251.216.187"), false);
  assert.equal(script.includes("gascity-server"), false);
  assert.match(workflow, /cursor\/harness-doppler-5527/);
  assert.match(workflow, /secrets\.HARNESS_API_KEY/);
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /probe-once/);
  assert.equal(workflow.includes("printenv"), false);
  assert.equal(workflow.includes("postgres://"), false);
});

test("the OIDC self-test prints claim shape and hides the token", () => {
  const result = spawnSync(
    "python3",
    ["scripts/harness/doppler_oidc.py", "--self-test"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /self_test=ok/);
  assert.match(result.stdout, /host_label=ep-muddy-sky-b31adt7z-pooler/);
  assert.match(result.stdout, /canary_refused=production_host/);
  assert.match(result.stdout, /wildcard=no/);
  assert.equal(result.stdout.includes("postgres://"), false);
  assert.equal(result.stdout.includes("hidden@example.com"), false);
  assert.equal(result.stdout.includes("dp.st."), false);
  assert.equal(result.stdout.includes("PRIVATE KEY"), false);
});
