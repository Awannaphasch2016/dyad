// The recorded Fargate host. This module does not call AWS.

export function assertPreviewHost(host) {
  if (!host || typeof host !== "object" || Array.isArray(host)) {
    throw new Error("Preview host record is missing");
  }
  if (host.started !== false) {
    throw new Error("Preview task must stay stopped");
  }
  if (host.region !== "ap-southeast-1" || host.cluster !== "preview-forma") {
    throw new Error("Refusing a host other than preview-forma");
  }
  const dns = String(host.albDns ?? "");
  if (!dns.endsWith(".ap-southeast-1.elb.amazonaws.com")) {
    throw new Error("Refusing a load balancer outside ap-southeast-1");
  }
  const text = `${dns} ${host.cluster}`.toLowerCase();
  if (text.includes("wewebplus") || text.includes("weaver")) {
    throw new Error("Refusing the Dyad preview host");
  }
  return host;
}
