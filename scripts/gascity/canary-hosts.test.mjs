import assert from "node:assert/strict";
import test from "node:test";
import { assertDistinctHosts } from "./canary-hosts.mjs";

const canary =
  "postgres://user:secret@ep-muddy-sky-b31adt7z-pooler.region.aws.neon.tech/neondb";
const production =
  "postgres://user:secret@ep-young-wave-b3cwe0rz-pooler.region.aws.neon.tech/neondb";

test("canary and production host labels stay distinct", () => {
  assert.deepEqual(assertDistinctHosts(canary, production), {
    canary: "ep-muddy-sky-b31adt7z-pooler",
    production: "ep-young-wave-b3cwe0rz-pooler",
  });
});

test("the canary host cannot stand in as production", () => {
  assert.throws(() => assertDistinctHosts(canary, canary), /production/);
});

test("the other prd branch fails as the canary", () => {
  const other =
    "postgres://user:secret@ep-royal-term-b3paoprp-pooler.region.aws.neon.tech/neondb";
  assert.throws(() => assertDistinctHosts(other, production), /canary/);
});
