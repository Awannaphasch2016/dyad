// Named tunnel for the canary hostname. The apex is never a write target.

export const canaryHostname = "pre.anakwannaphaschaiyong.com";
export const canaryAppsHostname = "*.apps.pre.anakwannaphaschaiyong.com";
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

export function assertCanaryDnsName(name) {
  if (name === canaryHostname || name === canaryAppsHostname) return;
  if (name === apexHostname || name === `www.${apexHostname}`) {
    throw new Error("Refusing to change the apex");
  }
  throw new Error("Refusing to change a hostname other than the canary");
}

export function canaryIngress() {
  assertCanaryHostname(canaryHostname);
  return {
    config: {
      ingress: [
        { hostname: canaryHostname, service: "http://127.0.0.1:8373" },
        { hostname: canaryAppsHostname, service: "http://127.0.0.1:8373" },
        { service: "http_status:404" },
      ],
    },
  };
}

const api = "https://api.cloudflare.com/client/v4";

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

export async function ensureCanaryTunnel({
  fetch: fetchImpl = fetch,
  accountId,
  zoneId,
  apiToken,
  writeToken,
}) {
  assertCanaryHostname(canaryHostname);
  if (!accountId || !zoneId || !apiToken) {
    throw new Error("Cloudflare account, zone, and token are required");
  }
  const listed = await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(canaryTunnelName)}&is_deleted=false`,
  );
  let tunnel = Array.isArray(listed)
    ? listed.find((item) => item.name === canaryTunnelName)
    : undefined;
  if (!tunnel) {
    tunnel = await cloudflare(
      fetchImpl,
      apiToken,
      `/accounts/${accountId}/cfd_tunnel`,
      {
        method: "POST",
        body: JSON.stringify({
          name: canaryTunnelName,
          config_src: "cloudflare",
        }),
      },
    );
  }
  await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`,
    { method: "PUT", body: JSON.stringify(canaryIngress()) },
  );
  const tokenResult = await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`,
  );
  const tunnelToken = (
    typeof tokenResult === "string" ? tokenResult : tokenResult?.token
  )?.trim();
  if (!tunnelToken) throw new Error("Cloudflare did not return a tunnel token");
  await writeToken(tunnelToken);
  await upsertCanaryDns(
    fetchImpl,
    apiToken,
    zoneId,
    canaryDnsRecord(tunnel.id),
  );
  await upsertCanaryDns(
    fetchImpl,
    apiToken,
    zoneId,
    canaryAppsDnsRecord(tunnel.id),
  );
  await ensureCanaryCertificate(fetchImpl, apiToken, zoneId);
  return {
    hostname: canaryHostname,
    tunnelId: tunnel.id,
    tunnelName: canaryTunnelName,
  };
}

export function cloudflareConfig(env) {
  return {
    apiToken: env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN_ || "",
    zoneId: env.CLOUDFLARE_ZONE_ID || env.CLOUDFLARE_ZONE_ID_ || "",
    accountId: env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID_ || "",
  };
}

function tunnelCname(name, tunnelId) {
  assertCanaryDnsName(name);
  if (!/^[0-9a-f-]{36}$/i.test(tunnelId || "")) {
    throw new Error("Tunnel id is not a UUID");
  }
  return {
    type: "CNAME",
    name,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  };
}

export function canaryDnsRecord(tunnelId) {
  return tunnelCname(canaryHostname, tunnelId);
}

export function canaryAppsDnsRecord(tunnelId) {
  return tunnelCname(canaryAppsHostname, tunnelId);
}

export function canaryCertificateOrder() {
  return {
    type: "advanced",
    hosts: [apexHostname, canaryAppsHostname],
    certificate_authority: "lets_encrypt",
    validation_method: "txt",
    validity_days: 90,
  };
}

async function ensureCanaryCertificate(fetchImpl, token, zoneId) {
  const packs = await cloudflare(
    fetchImpl,
    token,
    `/zones/${zoneId}/ssl/certificate_packs?status=all`,
  );
  const covered = Array.isArray(packs)
    ? packs.find(
        (pack) =>
          Array.isArray(pack.hosts) &&
          pack.hosts.includes(canaryAppsHostname) &&
          pack.status !== "deleted" &&
          pack.status !== "expired",
      )
    : undefined;
  if (covered) return covered;
  const order = canaryCertificateOrder();
  if (!order.hosts.includes(canaryAppsHostname)) {
    throw new Error(
      "Refusing to order a certificate without the preview names",
    );
  }
  return cloudflare(
    fetchImpl,
    token,
    `/zones/${zoneId}/ssl/certificate_packs/order`,
    { method: "POST", body: JSON.stringify(order) },
  );
}

async function upsertCanaryDns(fetchImpl, token, zoneId, record) {
  assertCanaryDnsName(record.name);
  const existing = await cloudflare(
    fetchImpl,
    token,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(record.name)}`,
  );
  const current = Array.isArray(existing) ? existing[0] : undefined;
  if (
    current &&
    current.name &&
    current.name !== record.name &&
    current.name !== `${record.name}.`
  ) {
    throw new Error("Refusing to change a hostname other than the canary");
  }
  if (!current) {
    await cloudflare(fetchImpl, token, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify(record),
    });
    return;
  }
  if (current.content !== record.content || current.proxied !== true) {
    await cloudflare(
      fetchImpl,
      token,
      `/zones/${zoneId}/dns_records/${current.id}`,
      { method: "PATCH", body: JSON.stringify(record) },
    );
  }
}
