// Named tunnel for the canary hostname. The apex is never a write target.

export const canaryHostname = "pre.anakwannaphaschaiyong.com";
export const apexHostname = "anakwannaphaschaiyong.com";
export const canaryTunnelName = "wewebplus-canary";

export function assertCanaryHostname(hostname) {
  if (hostname !== canaryHostname) {
    throw new Error("Refusing to change a hostname other than the canary");
  }
  if (hostname === apexHostname || hostname === `www.${apexHostname}`) {
    throw new Error("Refusing to change the apex");
  }
}

export function canaryIngress() {
  assertCanaryHostname(canaryHostname);
  return {
    config: {
      ingress: [
        { hostname: canaryHostname, service: "http://127.0.0.1:6080" },
        { service: "http_status:404" },
      ],
    },
  };
}

export function canaryDnsRecord(tunnelId) {
  assertCanaryHostname(canaryHostname);
  if (!/^[0-9a-f-]{36}$/i.test(tunnelId || "")) {
    throw new Error("Tunnel id is not a UUID");
  }
  return {
    type: "CNAME",
    name: canaryHostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  };
}
