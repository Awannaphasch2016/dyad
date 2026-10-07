// Cross-project Doppler references for the vibesdk lab.
// The stored value is a reference string. Secret values are not copied here.

export const sourceConfigOrder = ["dev", "preview", "canary", "prd"];

export const vibesdkReferences = [
  {
    dest: "CLOUDFLARE_API_TOKEN",
    sources: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_"],
  },
  {
    dest: "CLOUDFLARE_ACCOUNT_ID",
    sources: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID_"],
  },
  {
    dest: "OPENROUTER_API_KEY",
    sources: ["OPENROUTER_API_KEY"],
  },
  {
    dest: "NEON_API_KEY",
    sources: ["NEON_API_KEY"],
  },
  {
    dest: "NEON_PARENT_BRANCH_ID",
    sources: ["NEON_PARENT_BRANCH_ID"],
  },
];

export const blockedReferenceNames = [
  "WEWEBPLUS_DATABASE_URL",
  "GAS_CITY_HOST_BRIDGE_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_AI_STUDIO_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "CLERK_SECRET_KEY",
];

export function takeSecretNames(payload) {
  const secrets = payload?.secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    return [];
  }
  const names = [];
  for (const name of Object.keys(secrets)) {
    names.push(name);
    const entry = secrets[name];
    if (entry && typeof entry === "object") {
      entry.raw = undefined;
      entry.computed = undefined;
      entry.value = undefined;
    } else {
      secrets[name] = undefined;
    }
  }
  return names;
}

export function chooseReference(wanted, namesByConfig) {
  for (const config of sourceConfigOrder) {
    const names = namesByConfig?.[config];
    if (!names) continue;
    for (const source of wanted.sources) {
      if (names.has(source)) {
        return {
          dest: wanted.dest,
          config,
          source,
          reference: `\${dyad.${config}.${source}}`,
        };
      }
    }
  }
  return null;
}

export function referenceResolved(value) {
  if (typeof value !== "string" || value.trim() === "") return "absent";
  if (value.trim().startsWith("${")) return "unresolved";
  return "yes";
}

export function credentialShape(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("napi_")) return `napi length=${text.length}`;
  if (text.startsWith("sk-or-")) return `openrouter length=${text.length}`;
  if (text.startsWith("${")) return "reference";
  if (text === "") return "absent";
  return `other length=${text.length}`;
}

export function errorSummary(payload) {
  const error = payload?.errors?.[0] ?? payload?.error ?? payload;
  const code = error?.code ?? payload?.code ?? "";
  const message = error?.message ?? payload?.message ?? "";
  return { code: String(code), message: String(message) };
}

export function probeResult(status) {
  if (status === 200 || status === 201) return "allowed";
  if (status === 401 || status === 403) return "denied";
  if (status === 404) return "absent";
  return `status_${status}`;
}

export function cloudflareProbes(accountId) {
  const base = "https://api.cloudflare.com/client/v4";
  const probes = [["token", `${base}/user/tokens/verify`]];
  if (!accountId) return probes;
  const account = `${base}/accounts/${encodeURIComponent(accountId)}`;
  probes.push(
    ["account", account],
    ["workers_scripts", `${account}/workers/scripts`],
    ["d1", `${account}/d1/database`],
    ["dispatch_namespaces", `${account}/workers/dispatch/namespaces`],
    ["ai_gateway", `${account}/ai-gateway/gateways`],
  );
  return probes;
}
