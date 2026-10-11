// Point formula.anakwannaphaschaiyong.com at the formula load balancer.
// Does not create a tunnel and does not print token values.

export const FORMULA_HOSTNAME = "formula.anakwannaphaschaiyong.com";
export const FORMULA_PREVIEW_URL = `https://${FORMULA_HOSTNAME}`;

const ALB_DNS = /^[A-Za-z0-9.-]+\.ap-southeast-1\.elb\.amazonaws\.com$/;
const TUNNEL_NAME = /^pr-[0-9]+\.anakwannaphaschaiyong\.com$/;
const API = "https://api.cloudflare.com/client/v4";

export function formulaAliasRecord(loadBalancerDns) {
  if (!ALB_DNS.test(loadBalancerDns || "")) {
    throw new Error("Load balancer DNS name was not in ap-southeast-1");
  }
  return {
    type: "CNAME",
    name: FORMULA_HOSTNAME,
    content: loadBalancerDns,
    proxied: true,
    ttl: 1,
  };
}

function normalizeDnsName(name) {
  return String(name || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

export function formulaValidationRecord(name, value) {
  const host = normalizeDnsName(name);
  const content = String(value || "")
    .trim()
    .replace(/\.$/, "");
  if (TUNNEL_NAME.test(host)) {
    throw new Error("Refusing to change a pull request tunnel name");
  }
  if (host !== FORMULA_HOSTNAME && !host.endsWith(`.${FORMULA_HOSTNAME}`)) {
    throw new Error("ACM validation name is not under the formula hostname");
  }
  if (!content.endsWith(".acm-validations.aws")) {
    throw new Error("ACM validation target was not recognized");
  }
  return {
    type: "CNAME",
    name: host,
    content,
    proxied: false,
    ttl: 1,
  };
}

export function cloudflareFromMaps(env = {}, downloads = []) {
  const merged = {};
  for (const download of downloads) {
    if (download && typeof download === "object") {
      Object.assign(merged, download);
    }
  }
  const pick = (key) => {
    const fromEnv = env[key];
    if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
    const fromDownload = merged[key];
    return typeof fromDownload === "string" ? fromDownload.trim() : "";
  };
  return {
    token: pick("CLOUDFLARE_API_TOKEN"),
    zoneId: pick("CLOUDFLARE_ZONE_ID"),
    accountId: pick("CLOUDFLARE_ACCOUNT_ID"),
  };
}

export function cloudflarePresence(creds) {
  return [
    `CLOUDFLARE_API_TOKEN: ${creds.token ? "present" : "absent"}`,
    `CLOUDFLARE_ZONE_ID: ${creds.zoneId ? "present" : "absent"}`,
    `CLOUDFLARE_ACCOUNT_ID: ${creds.accountId ? "present" : "absent"}`,
  ].join("\n");
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

async function upsertRecord(fetchImpl, token, zoneId, record) {
  if (TUNNEL_NAME.test(record.name)) {
    throw new Error("Refusing to change a pull request tunnel name");
  }
  const existing = await cloudflare(
    fetchImpl,
    token,
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(record.name)}`,
  );
  const current = Array.isArray(existing) ? existing[0] : undefined;
  if (!current) {
    await cloudflare(fetchImpl, token, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify(record),
    });
    return;
  }
  if (
    current.content === record.content &&
    current.proxied === record.proxied
  ) {
    return;
  }
  await cloudflare(
    fetchImpl,
    token,
    `/zones/${zoneId}/dns_records/${current.id}`,
    {
      method: "PATCH",
      body: JSON.stringify(record),
    },
  );
}

export async function ensureFormulaDns({
  fetch: fetchImpl = fetch,
  token,
  zoneId,
  accountId,
  loadBalancerDns,
  validationName,
  validationValue,
}) {
  if (!token || !zoneId || !accountId) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, and CLOUDFLARE_ACCOUNT_ID are required",
    );
  }
  await cloudflare(fetchImpl, token, `/accounts/${accountId}`);
  const records = [formulaAliasRecord(loadBalancerDns)];
  if (validationName || validationValue) {
    records.push(formulaValidationRecord(validationName, validationValue));
  }
  for (const record of records) {
    await upsertRecord(fetchImpl, token, zoneId, record);
  }
  return { hostname: FORMULA_HOSTNAME };
}
