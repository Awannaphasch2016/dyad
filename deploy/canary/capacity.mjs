// Read-only identity of the canary capacity. Production is not a member.

export const canaryCluster = "wewebplus";
export const canaryInstanceId = "i-023d741ed3a1b3b25";

export function assertCanaryCapacity({
  clusterInstanceIds,
  productionInstanceId,
}) {
  const members = clusterInstanceIds ?? [];
  if (!members.includes(canaryInstanceId)) {
    throw new Error("canary capacity instance is absent");
  }
  if (productionInstanceId && members.includes(productionInstanceId)) {
    throw new Error("gascity-server is in the canary cluster");
  }
  if (productionInstanceId === canaryInstanceId) {
    throw new Error("gascity-server and the canary instance are the same");
  }
}
