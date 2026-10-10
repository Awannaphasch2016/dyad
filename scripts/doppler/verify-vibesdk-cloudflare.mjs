// Read vibesdk/dev and check the Cloudflare token. Does not write secrets.

import { redact, VIBESDK_PROJECT_NAME } from "./vibesdk-project.mjs";
import {
  cloudflareProbes,
  credentialShape,
  errorSummary,
  probeResult,
  referenceResolved,
  storedSecretKind,
} from "./vibesdk-references.mjs";

async function doppler(token, method, path) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = payload?.message || text;
    throw new Error(
      `${method} ${path.split("?")[0]} ${response.status} ${redact(message)}`,
    );
  }
  return payload;
}

function mask(value) {
  if (typeof value === "string" && value.length > 0) {
    console.log(`::add-mask::${value}`);
  }
}

async function apiStatus(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }
  return { status: response.status, payload };
}

const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
if (!token) {
  console.log("admin_token=absent");
  process.exit(1);
}

const listed = await doppler(
  token,
  "GET",
  `/v3/configs/config/secrets?project=${VIBESDK_PROJECT_NAME}&config=dev`,
);
for (const name of ["CLOUDFLARE_API_TOKEN", "ANTHROPIC_API_KEY"]) {
  const entry = listed.secrets?.[name];
  console.log(`${name}_stored=${storedSecretKind(entry?.raw)}`);
  if (entry && typeof entry === "object") {
    entry.raw = undefined;
    entry.computed = undefined;
  }
}

const downloaded = await doppler(
  token,
  "GET",
  `/v3/configs/config/secrets/download?project=${VIBESDK_PROJECT_NAME}&config=dev&format=json`,
);
const cloudflareToken = downloaded.CLOUDFLARE_API_TOKEN;
const accountId = downloaded.CLOUDFLARE_ACCOUNT_ID;
mask(cloudflareToken);
mask(accountId);
console.log(
  `CLOUDFLARE_API_TOKEN=${referenceResolved(cloudflareToken)} shape=${credentialShape(cloudflareToken)}`,
);
console.log(`CLOUDFLARE_ACCOUNT_ID=${referenceResolved(accountId)}`);
console.log(
  `ANTHROPIC_API_KEY=${referenceResolved(downloaded.ANTHROPIC_API_KEY)} shape=${credentialShape(downloaded.ANTHROPIC_API_KEY)}`,
);

if (referenceResolved(cloudflareToken) !== "yes") {
  console.log("cloudflare_token=skipped");
  process.exit(0);
}

const probes = cloudflareProbes(accountId);
if (accountId) {
  probes.push([
    "account_token",
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
  ]);
}
for (const [name, url] of probes) {
  const result = await apiStatus(url, {
    Authorization: `Bearer ${cloudflareToken}`,
    Accept: "application/json",
  });
  const tokenStatus = result.payload?.result?.status;
  const summary = errorSummary(result.payload);
  const detail = [
    tokenStatus ? `token_status=${tokenStatus}` : "",
    summary.code ? `code=${redact(summary.code)}` : "",
    result.status !== 200 && summary.message
      ? `message=${redact(summary.message)}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `cloudflare_${name}=${probeResult(result.status, result.payload)}${detail ? ` ${detail}` : ""}`,
  );
}

const anthropicKey = downloaded.ANTHROPIC_API_KEY;
mask(anthropicKey);
if (referenceResolved(anthropicKey) === "yes") {
  const models = await apiStatus("https://api.anthropic.com/v1/models", {
    "x-api-key": anthropicKey,
    "anthropic-version": "2023-06-01",
    Accept: "application/json",
  });
  const rows = models.payload?.data ?? [];
  const claude = rows.filter(
    (model) =>
      typeof model?.id === "string" &&
      model.id.toLowerCase().includes("claude"),
  );
  const summary = errorSummary(models.payload);
  console.log(
    `anthropic_models=${probeResult(models.status, models.payload)} count=${rows.length} claude=${claude.length} code=${redact(summary.code) || "none"} message=${redact(summary.message) || "none"}`,
  );
}
