import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultBranchId,
  formaHostLabel,
  formaProjectBody,
} from "./forma-neon-branch.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/forma-neon-branch.yml", import.meta.url),
  "utf8",
);
const script = readFileSync(
  new URL("./forma-neon-branch.mjs", import.meta.url),
  "utf8",
);

test("forma is a new empty Neon project in Singapore", () => {
  assert.deepEqual(formaProjectBody("org-example"), {
    project: {
      name: "forma",
      org_id: "org-example",
      region_id: "aws-ap-southeast-1",
      pg_version: 17,
    },
  });
  assert.throws(() => formaProjectBody(""), /org id/);
});

test("the default branch id is preferred", () => {
  assert.equal(
    defaultBranchId([
      { id: "br-other", default: false },
      { id: "br-main", default: true },
    ]),
    "br-main",
  );
  assert.throws(() => defaultBranchId([]), /no branch/);
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
  assert.equal(script.includes("parent_id"), false);
  assert.equal(script.includes("proud-salad-68182047"), false);
  assert.match(script, /orgLookupProjectId/);
  assert.match(script, /aws-ap-southeast-1/);
});
