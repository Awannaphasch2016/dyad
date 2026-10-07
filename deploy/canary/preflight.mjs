// Checks that must pass before a canary task is registered.

import {
  bareEndpoint,
  hitlPrdBranchEndpoint,
  productionEndpoint,
} from "../../scripts/gascity/pre-promotion-verdict.mjs";
import { canaryInstanceId } from "./capacity.mjs";
import {
  assertPrivateBridge,
  canarySecurityGroup,
} from "./task_definition.mjs";

export const canaryRuntimeNames = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "GAS_CITY_HOST_BRIDGE_TOKEN",
  "NOVNC_PASSWORD",
  "WEWEBPLUS_DATABASE_URL",
  "WEWEBPLUS_SECRETS_KEY",
];

export function missingNames(env, names = canaryRuntimeNames) {
  return names.filter((name) => !env?.[name]);
}

export function assertCanaryDeploy({
  canaryHost,
  rules,
  clusterName,
  instanceId,
  securityGroupId,
}) {
  if (clusterName !== "wewebplus") {
    throw new Error("Canary deploy only targets cluster wewebplus");
  }
  if (instanceId !== canaryInstanceId) {
    throw new Error("Canary deploy only uses the canary capacity instance");
  }
  if (securityGroupId !== canarySecurityGroup) {
    throw new Error("Canary deploy only uses the canary security group");
  }
  assertPrivateBridge(rules);
  const bare = bareEndpoint(canaryHost);
  if (!bare) throw new Error("Canary database host is absent");
  if (bare === productionEndpoint) {
    throw new Error("Refusing to deploy the canary on the production database");
  }
  if (bare === hitlPrdBranchEndpoint) {
    throw new Error(
      "Refusing to deploy the canary on the Wewebplus-hitl prd branch",
    );
  }
  return { canaryHost: bare };
}
