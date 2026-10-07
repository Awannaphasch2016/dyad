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

function identityUuid(identity) {
  if (!identity) return "";
  for (const value of [identity.id, identity.identity_id, identity.slug]) {
    if (
      typeof value === "string" &&
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        value,
      )
    ) {
      return value;
    }
  }
  return "";
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function ensureServiceAccount(token) {
  const accounts = await doppler(
    token,
    "GET",
    "/v3/workplace/service_accounts",
  );
  const listedAccounts =
    accounts.service_accounts ?? accounts.workplace_service_accounts ?? [];
  const wanted = canaryServiceAccount.toLowerCase();
  let account = listedAccounts.find((item) => {
    const name = String(item.name || "").toLowerCase();
    const slug = String(item.slug || "").toLowerCase();
    return name === wanted || slug === wanted;
  });
  if (!account) {
    const created = await doppler(token, "POST", "/v3/workplace/service_accounts", {
      name: canaryServiceAccount,
    });
    account = created.service_account ?? created;
    console.log("service_account=created");
  } else {
    console.log("service_account=exists");
  }
  if (!account?.slug) throw new Error("service account slug is absent");
  const member = await fetch(
    "https://api.doppler.com/v3/projects/project/members?project=dyad",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "service_account",
        slug: account.slug,
        role: "viewer",
        environments: ["canary"],
      }),
    },
  );
  if (member.ok) {
    console.log("service_account_access=dyad/canary added");
  } else if (member.status === 409 || member.status === 422) {
    await doppler(
      token,
      "PATCH",
      `/v3/projects/project/members/member/service_account/${encodeURIComponent(account.slug)}?project=dyad`,
      { role: "viewer", environments: ["canary"] },
    );
    console.log("service_account_access=dyad/canary updated");
  } else {
    const text = await member.text();
    throw new Error(
      `POST /v3/projects/project/members ${member.status} ${redact(text)}`,
    );
  }
  return account;
}

async function ensureIdentity(token) {
  const account = await ensureServiceAccount(token);
  const listed = await doppler(
    token,
    "GET",
    `/v3/workplace/service_accounts/service_account/${account.slug}/identities`,
  );
  const identities =
    listed.identities ?? listed.service_account_identities ?? [];
  console.log(`identity_count=${identities.length}`);
  console.log(
    `identity_names=${identities.map((item) => `${item.slug || "no-slug"}:${item.name || "no-name"}`).join(",") || "none"}`,
  );
  const body = canaryIdentityBody();
  const existing = matchingIdentity(identities, body) ??
    identities.find((item) => item?.name === body.name);
  const existingId = identityUuid(existing);
  if (existingId) {
    console.log("identity=exists");
    return existingId;
  }
  const created = await doppler(
    token,
    "POST",
    `/v3/workplace/service_accounts/service_account/${account.slug}/identities`,
    body,
  );
  const identity =
    created.identity ?? created.service_account_identity ?? created;
  const identityId = identityUuid(identity);
  if (!identityId) {
    console.log(`identity_fields=${Object.keys(identity).join(",") || "none"}`);
    throw new Error("Doppler did not return an identity id");
  }
  console.log("identity=created");
  return identityId;
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
