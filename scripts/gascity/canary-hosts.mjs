// Compare Doppler host labels. The connection strings are not printed.

import {
  bareEndpoint,
  canaryEndpoint,
  productionEndpoint,
} from "./pre-promotion-verdict.mjs";

export function hostLabel(databaseUrl) {
  const host = new URL(databaseUrl).hostname || "";
  return host.split(".")[0];
}

export function assertDistinctHosts(canaryUrl, productionUrl) {
  const canary = hostLabel(canaryUrl);
  const production = hostLabel(productionUrl);
  if (bareEndpoint(canary) !== canaryEndpoint) {
    throw new Error("canary database host mismatch");
  }
  if (bareEndpoint(production) !== productionEndpoint) {
    throw new Error("production database host mismatch");
  }
  if (bareEndpoint(canary) === bareEndpoint(production)) {
    throw new Error("canary and production hosts are equal");
  }
  return { canary, production };
}
