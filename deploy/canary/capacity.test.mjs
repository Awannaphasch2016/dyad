import assert from "node:assert/strict";
import test from "node:test";
import { assertCanaryCapacity, canaryInstanceId } from "./capacity.mjs";

test("the canary instance is required and production stays out of the cluster", () => {
  assert.doesNotThrow(() =>
    assertCanaryCapacity({
      clusterInstanceIds: [canaryInstanceId],
      productionInstanceId: "i-production",
    }),
  );
  assert.throws(
    () =>
      assertCanaryCapacity({
        clusterInstanceIds: [canaryInstanceId, "i-production"],
        productionInstanceId: "i-production",
      }),
    /gascity-server/,
  );
  assert.throws(
    () => assertCanaryCapacity({ clusterInstanceIds: [] }),
    /absent/,
  );
});
