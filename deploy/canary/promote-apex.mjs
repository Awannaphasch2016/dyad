// Manual publish of the bare domain onto the canary tunnel.
// The canary deploy writer still refuses this name.

import { canaryTunnelName } from "./tunnel.mjs";

export const apexHostname = "anakwannaphaschaiyong.com";
const preHostname = "pre.anakwannaphaschaiyong.com";
const previewHostname = "*.anakwannaphaschaiyong.com";
const api = "https://api.cloudflare.com/client/v4";

export function assertPromotionHostname(name) {
  if (name !== apexHostname) {
    throw new Error("Refusing to publish a hostname other than the apex");
  }
}

export function promotionIngress() {
  assertPromotionHostname(apexHostname);
  return {
    config: {
      ingress: [
        { hostname: apexHostname, service: "http://127.0.0.1:8373" },
        { hostname: preHostname, service: "http://127.0.0.1:8373" },
        { hostname: previewHostname, service: "http://127.0.0.1:8373" },
        { service: "http_status:404" },
      ],
    },
  };
}

export function apexDnsRecord(tunnelId) {
  assertPromotionHostname(apexHostname);
  if (!/^[0-9a-f-]{36}$/i.test(tunnelId || "")) {
    throw new Error("Tunnel id is not a UUID");
  }
  return {
    type: "CNAME",
    name: apexHostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  };
}

async function cloudflare(fetchImpl, token, path, init = {}) {
  const response = await fetchImpl(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    const detail = Array.isArray(body.errors)
      ? body.errors.map((error) => error.message).join("; ")
      : response.statusText;
    throw new Error(`Cloudflare ${path} failed: ${detail}`);
  }
  return body.result;
}

export async function promoteApex({
  fetch: fetchImpl = fetch,
  accountId,
  zoneId,
  apiToken,
}) {
  assertPromotionHostname(apexHostname);
  if (!accountId || !zoneId || !apiToken) {
    throw new Error("Cloudflare account, zone, and token are required");
  }
  const listed = await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(canaryTunnelName)}&is_deleted=false`,
  );
  const tunnel = Array.isArray(listed)
    ? listed.find((item) => item.name === canaryTunnelName)
    : undefined;
  if (!tunnel?.id) throw new Error("Canary tunnel was not found");
  const ingress = promotionIngress();
  if (
    ingress.config.ingress.some(
      (rule) => rule.hostname === `www.${apexHostname}`,
    )
  ) {
    throw new Error("Refusing to publish www");
  }
  await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`,
    { method: "PUT", body: JSON.stringify(ingress) },
  );
  const record = apexDnsRecord(tunnel.id);
  const existing = await cloudflare(
    fetchImpl,
    apiToken,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(record.name)}`,
  );
  const current = Array.isArray(existing) ? existing[0] : undefined;
  if (
    current?.name &&
    current.name !== record.name &&
    current.name !== `${record.name}.`
  ) {
    throw new Error("Refusing to publish a hostname other than the apex");
  }
  if (!current) {
    await cloudflare(fetchImpl, apiToken, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify(record),
    });
  } else if (current.content !== record.content || current.proxied !== true) {
    await cloudflare(
      fetchImpl,
      apiToken,
      `/zones/${zoneId}/dns_records/${current.id}`,
      { method: "PATCH", body: JSON.stringify(record) },
    );
  }
  return { hostname: apexHostname, tunnelId: tunnel.id };
}
