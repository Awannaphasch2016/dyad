// Create the canary GitHub identity and print database host labels.
// Secret values are not printed.

import { appendFileSync } from "node:fs";
import {
  canaryIdentityBody,
  canaryServiceAccount,
  matchingIdentity,
  secretsToCopy,
} from "./canary-identity.mjs";
import { assertDistinctHosts } from "./canary-hosts.mjs";

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .slice(0, 180);
}

async function doppler(token, method, path, body) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: redact(text) };
    }
  }
  if (!response.ok) {
    const message =
      payload?.message || payload?.messages?.[0] || response.statusText;
    throw new Error(
      `${method} ${path.split("?")[0]} ${response.status} ${redact(message)}`,
    );
  }
  return payload;
}

async function download(token, config) {
  const payload = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=dyad&config=${config}&format=json`,
  );
  return Object.fromEntries(
    Object.entries(payload).filter((entry) => typeof entry[1] === "string"),
  );
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function ensureIdentity(token) {
  const accounts = await doppler(
    token,
    "GET",
    "/v3/workplace/service_accounts",
  );
  const listedAccounts =
    accounts.service_accounts ?? accounts.workplace_service_accounts ?? [];
  const names = listedAccounts.map(
    (item) => `${item.slug || "no-slug"}:${item.name || "no-name"}`,
  );
  console.log(`service_account_count=${listedAccounts.length}`);
  console.log(`service_accounts=${names.join(",") || "none"}`);
  const wanted = canaryServiceAccount.toLowerCase();
  const account = listedAccounts.find((item) => {
    const name = String(item.name || "").toLowerCase();
    const slug = String(item.slug || "").toLowerCase();
    return name === wanted || slug === wanted || name.includes("canary") || slug.includes("canary");
  });
  if (!account?.slug)
    throw new Error("service account wewebplus-canary is absent");
  const listed = await doppler(
    token,
    "GET",
    `/v3/workplace/service_accounts/service_account/${account.slug}/identities`,
  );
  const identities =
    listed.identities ?? listed.service_account_identities ?? [];
  const body = canaryIdentityBody();
  const existing = matchingIdentity(identities, body);
  if (existing?.id) {
    console.log("identity=exists");
    return existing.id;
  }
  const created = await doppler(
    token,
    "POST",
    `/v3/workplace/service_accounts/service_account/${account.slug}/identities`,
    body,
  );
  const identity =
    created.identity ?? created.service_account_identity ?? created;
  if (!identity?.id) throw new Error("Doppler did not return an identity id");
  console.log("identity=created");
  return identity.id;
}

export async function main() {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) throw new Error("DOPPLER_ADMIN_TOKEN absent");
  const identityId = await ensureIdentity(token);
  writeOutput("identity_id", identityId);
  console.log(`identity_id=${identityId}`);

  const canary = await download(token, "canary");
  const prd = await download(token, "prd");
  const labels = assertDistinctHosts(
    canary.WEWEBPLUS_DATABASE_URL,
    prd.WEWEBPLUS_DATABASE_URL,
  );
  console.log(`canary_db=${labels.canary}`);
  console.log(`prd_db=${labels.production}`);

  const preview = await download(token, "preview");
  const copy = secretsToCopy(preview, canary);
  const names = Object.keys(copy);
  if (names.length > 0) {
    await doppler(token, "POST", "/v3/configs/config/secrets", {
      project: "dyad",
      config: "canary",
      secrets: copy,
    });
  }
  console.log(`copied=${names.join(",") || "none"}`);
}

const isDirectRun = process.argv[1]?.endsWith("ensure-canary-identity.mjs");
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "identity setup failed",
    );
    process.exitCode = 1;
  });
}
