import assert from "node:assert/strict";
import test from "node:test";
import { canaryInstanceId } from "./capacity.mjs";
import { assertCanaryDeploy, missingNames } from "./preflight.mjs";
import { canarySecurityGroup } from "./task_definition.mjs";

const allowed = {
  canaryHost: "ep-bold-sky-b3ucveke-pooler",
  rules: [],
  clusterName: "wewebplus",
  instanceId: canaryInstanceId,
  securityGroupId: canarySecurityGroup,
};

test("a private canary deploy on the live canary host is allowed", () => {
  assert.deepEqual(assertCanaryDeploy(allowed), {
    canaryHost: "ep-bold-sky-b3ucveke",
  });
});

test("production, the other prd branch, and a public bridge are refused", () => {
  assert.throws(
    () =>
      assertCanaryDeploy({
        ...allowed,
        canaryHost: "ep-young-wave-b3cwe0rz-pooler",
      }),
    /production database/,
  );
  assert.throws(
    () =>
      assertCanaryDeploy({
        ...allowed,
        canaryHost: "ep-royal-term-b3paoprp-pooler",
      }),
    /prd branch/,
  );
  assert.throws(
    () =>
      assertCanaryDeploy({
        ...allowed,
        rules: [{ cidr: "0.0.0.0/0", port: 32100 }],
      }),
    /32100/,
  );
});

test("missing runtime names are listed without values", () => {
  assert.deepEqual(missingNames({ NOVNC_PASSWORD: "secret" }), [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "GAS_CITY_HOST_BRIDGE_TOKEN",
    "WEWEBPLUS_DATABASE_URL",
    "WEWEBPLUS_SECRETS_KEY",
  ]);
});
