import assert from "node:assert/strict";
import test from "node:test";
import { removeCanaryDatabaseEnv } from "./remove-vercel-database-env.mjs";

test("the cleanup refuses to run without the project token", async () => {
  await assert.rejects(
    () => removeCanaryDatabaseEnv(""),
    /VERCEL_ANAK2_TOKEN absent/,
  );
});
