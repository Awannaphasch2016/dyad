import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  branchIdForEndpoint,
  formaHostLabel,
  schemaOnlyBranchBody,
} from "./forma-neon-branch.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/forma-neon-branch.yml", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("./forma-neon-branch.mjs", import.meta.url),
  "utf8",
);

test("the dev endpoint resolves to its Neon branch", () => {
  const branchId = branchIdForEndpoint(
    [
      {
        id: "ep-other",
        host: "ep-other.example",
        branch_id: "br-other",
      },
      {
        id: "ep-wild-paper-b3yf26si",
        host: "ep-wild-paper-b3yf26si.example",
        pooler_host: "ep-wild-paper-b3yf26si-pooler.example",
        branch_id: "br-dev-source",
      },
    ],
    "ep-wild-paper-b3yf26si",
  );
  assert.equal(branchId, "br-dev-source");
});

test("a forma branch copies schema and no rows", () => {
  assert.deepEqual(schemaOnlyBranchBody("br-dev-source"), {
    branch: {
      parent_id: "br-dev-source",
      name: "forma",
      init_source: "schema-only",
    },
    endpoints: [{ type: "read_write" }],
  });
  assert.throws(() => schemaOnlyBranchBody("not-a-branch"), /schema source/);
});

test("forma refuses the shared dev and production endpoints", () => {
  assert.equal(formaHostLabel("ep-forma-child.example"), "ep-forma-child");
  assert.throws(
    () => formaHostLabel("ep-wild-paper-b3yf26si-pooler.example"),
    /dyad endpoint/,
  );
  assert.throws(
    () => formaHostLabel("ep-young-wave-b3cwe0rz.example"),
    /dyad endpoint/,
  );
});

test("the forma branch workflow does not print a database url", () => {
  assert.match(workflow, /cursor\/forma-doppler-5014/);
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /sudo sh/);
  assert.match(workflow, /node scripts\/gascity\/forma-neon-branch\.mjs/);
  assert.equal(workflow.includes("set -x"), false);
  assert.equal(workflow.includes("printenv"), false);
  assert.equal(workflow.includes("dyad/prd"), false);
  assert.equal(script.includes("parent-data"), false);
  assert.match(script, /schema-only/);
  assert.match(script, /mute-credit-71067312/);
  assert.equal(script.includes("proud-salad-68182047"), false);
});
