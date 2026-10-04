// Creates the Cloudflare named tunnel and CNAME for one preview.
// The tunnel token is written to a file. It is not returned and not logged.

const API = "https://api.cloudflare.com/client/v4";
export const PREVIEW_ZONE = "anakwannaphaschaiyong.com";

export function previewHostname(pr) {
  const value = String(pr);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("PR number must be digits");
  }
  return `pr-${value}.${PREVIEW_ZONE}`;
}

export function gasCityHostname(pr) {
  const value = String(pr);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("PR number must be digits");
  }
  return `gc-pr-${value}.${PREVIEW_ZONE}`;
}

export function tunnelName(pr) {
  const value = String(pr);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("PR number must be digits");
  }
  return `preview-pr-${value}`;
}

export function ingressConfig(pr) {
  return {
    config: {
      ingress: [
        { hostname: previewHostname(pr), service: "http://127.0.0.1:8373" },
        { hostname: gasCityHostname(pr), service: "http://gascity:8787" },
        { service: "http_status:404" },
      ],
    },
  };
}

export function dnsRecord(hostname, tunnelId) {
  return {
    type: "CNAME",
    name: hostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  };
}

async function cloudflare(fetchImpl, token, path, init = {}) {
  const response = await fetchImpl(`${API}${path}`, {
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

export async function ensurePreviewTunnel({
  fetch: fetchImpl = fetch,
  accountId,
  zoneId,
  apiToken,
  pr,
  writeToken,
}) {
  if (!accountId || !zoneId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID_, and CLOUDFLARE_API_TOKEN_ are required",
    );
  }
  const hostname = previewHostname(pr);
  const name = tunnelName(pr);
  const listed = await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
  );
  let tunnel = Array.isArray(listed)
    ? listed.find((item) => item.name === name)
    : undefined;
  if (!tunnel) {
    tunnel = await cloudflare(
      fetchImpl,
      apiToken,
      `/accounts/${accountId}/cfd_tunnel`,
      {
        method: "POST",
        body: JSON.stringify({ name, config_src: "cloudflare" }),
      },
    );
  }
  await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`,
    {
      method: "PUT",
      body: JSON.stringify(ingressConfig(pr)),
    },
  );
  const tokenResult = await cloudflare(
    fetchImpl,
    apiToken,
    `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`,
  );
  const tunnelToken = (
    typeof tokenResult === "string" ? tokenResult : tokenResult?.token
  )?.trim();
  if (!tunnelToken) {
    throw new Error("Cloudflare did not return a tunnel token");
  }
  await writeToken(tunnelToken);

  for (const dnsName of [hostname, gasCityHostname(pr)]) {
    const record = dnsRecord(dnsName, tunnel.id);
    const existing = await cloudflare(
      fetchImpl,
      apiToken,
      `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(dnsName)}`,
    );
    const current = Array.isArray(existing) ? existing[0] : undefined;
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
        {
          method: "PATCH",
          body: JSON.stringify(record),
        },
      );
    }
  }
  return {
    hostname,
    gasCityHostname: gasCityHostname(pr),
    tunnelId: tunnel.id,
    tunnelName: name,
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function main() {
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url !== pathToFileURL(process.argv[1]).href) return;
  const pr = process.argv[2];
  const tokenPath = process.argv[3];
  if (!pr || !tokenPath) {
    throw new Error("Usage: preview-tunnel.mjs <pr> <token-file>");
  }
  const { writeFile } = await import("node:fs/promises");
  const result = await ensurePreviewTunnel({
    accountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    zoneId: requireEnv("CLOUDFLARE_ZONE_ID_"),
    apiToken: requireEnv("CLOUDFLARE_API_TOKEN_"),
    pr,
    writeToken: (token) => writeFile(tokenPath, token, { mode: 0o600 }),
  });
  process.stdout.write(`${result.hostname} ${result.tunnelId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});
