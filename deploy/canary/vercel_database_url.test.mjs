import assert from "node:assert/strict";
import test from "node:test";
import { removalTarget } from "./vercel_database_url.mjs";

test("only the dyad database URL is a removal target", () => {
  assert.deepEqual(removalTarget("dyad", "WEWEBPLUS_DATABASE_URL"), {
    project: "dyad",
    key: "WEWEBPLUS_DATABASE_URL",
  });
  assert.throws(() => removalTarget("other", "WEWEBPLUS_DATABASE_URL"), /dyad/);
  assert.throws(
    () => removalTarget("dyad", "CLERK_SECRET_KEY"),
    /database URL/,
  );
});
