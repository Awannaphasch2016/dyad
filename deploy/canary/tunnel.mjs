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
  const record = canaryDnsRecord(tunnel.id);
  const existing = await cloudflare(
    fetchImpl,
    apiToken,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(canaryHostname)}`,
  );
  const current = Array.isArray(existing) ? existing[0] : undefined;
  if (
    current &&
    current.name &&
    current.name !== canaryHostname &&
    current.name !== `${canaryHostname}.`
  ) {
    throw new Error("Refusing to change a hostname other than the canary");
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
