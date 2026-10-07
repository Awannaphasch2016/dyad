// Point vibesdk/dev at existing Dyad secrets with Doppler references.
// Prints names and check results. Does not print secret values.
// Reads are limited to token checks. This file does not create Neon branches
// or Cloudflare resources.

import { redact, VIBESDK_PROJECT_NAME } from "./vibesdk-project.mjs";
import {
  chooseReference,
  cloudflareProbes,
  credentialShape,
  errorSummary,
  probeResult,
  referenceResolved,
  takeSecretNames,
  vibesdkReferences,
} from "./vibesdk-references.mjs";

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
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = payload?.message || text;
    const error = new Error(
      `${method} ${path.split("?")[0]} ${response.status} ${redact(message)}`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function secretNames(token, config) {
  try {
    const payload = await doppler(
      token,
      "GET",
      `/v3/configs/config/secrets?project=dyad&config=${encodeURIComponent(config)}`,
    );
    return takeSecretNames(payload);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
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

function mask(value) {
  if (typeof value === "string" && value.length > 0) {
    console.log(`::add-mask::${value}`);
  }
}

const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
if (!token) {
  console.log("admin_token=absent");
  process.exit(1);
}

const configs = await doppler(
  token,
  "GET",
  "/v3/configs?project=dyad&page=1&per_page=100",
);
const configNames = (configs.configs ?? [])
  .map((config) => String(config?.name ?? ""))
  .filter(Boolean);
console.log(`dyad_configs=${configNames.join(",") || "none"}`);

const namesByConfig = {};
for (const name of configNames) {
  const names = await secretNames(token, name);
  if (names == null) {
    console.log(`dyad_${name}=absent`);
    continue;
  }
  namesByConfig[name] = new Set(names);
  console.log(`dyad_${name}_names=${names.length}`);
}

const selected = [];
for (const wanted of vibesdkReferences) {
  const choice = chooseReference(wanted, namesByConfig);
  if (!choice) {
    console.log(`source ${wanted.dest}=absent`);
    continue;
  }
  selected.push(choice);
  console.log(
    `source ${choice.dest}=dyad/${choice.config} name=${choice.source}`,
  );
}

if (selected.length > 0) {
  const secrets = {};
  for (const choice of selected) secrets[choice.dest] = choice.reference;
  await doppler(token, "POST", "/v3/configs/config/secrets", {
    project: VIBESDK_PROJECT_NAME,
    config: "dev",
    secrets,
  });
  console.log(
    `references_written=${selected.map((choice) => choice.dest).join(",")}`,
  );
}

const downloaded = await doppler(
  token,
  "GET",
  `/v3/configs/config/secrets/download?project=${VIBESDK_PROJECT_NAME}&config=dev&format=json`,
);
for (const choice of selected) {
  const value = downloaded[choice.dest];
  mask(value);
  console.log(`${choice.dest}=${referenceResolved(value)}`);
}

const cloudflareToken = downloaded.CLOUDFLARE_API_TOKEN;
const accountId = downloaded.CLOUDFLARE_ACCOUNT_ID;
if (referenceResolved(cloudflareToken) === "yes") {
  for (const [name, url] of cloudflareProbes(accountId)) {
    const result = await apiStatus(url, {
      Authorization: `Bearer ${cloudflareToken}`,
      Accept: "application/json",
    });
    const tokenStatus = result.payload?.result?.status;
    const summary = errorSummary(result.payload);
    const detail = [
      name === "token" && tokenStatus ? `token_status=${tokenStatus}` : "",
      summary.code ? `code=${redact(summary.code)}` : "",
      result.status !== 200 && summary.message
        ? `message=${redact(summary.message)}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `cloudflare_${name}=${probeResult(result.status)}${detail ? ` ${detail}` : ""}`,
    );
  }
  console.log(`cloudflare_token_shape=${credentialShape(cloudflareToken)}`);
} else {
  console.log("cloudflare_token=skipped");
}

const openRouterKey = downloaded.OPENROUTER_API_KEY;
if (referenceResolved(openRouterKey) === "yes") {
  const keyCheck = await apiStatus("https://openrouter.ai/api/v1/key", {
    Authorization: `Bearer ${openRouterKey}`,
    Accept: "application/json",
  });
  const label = keyCheck.payload?.data?.label;
  console.log(
    `openrouter_key=${probeResult(keyCheck.status)} label=${typeof label === "string" && label ? "present" : "absent"} shape=${credentialShape(openRouterKey)}`,
  );
  const completion = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [{ role: "user", content: "Reply with ok" }],
        max_tokens: 8,
      }),
    },
  );
  console.log(`openrouter_completion=${probeResult(completion.status)}`);
  await completion.text();
} else {
  console.log("openrouter_key=skipped");
}

const neonKey = downloaded.NEON_API_KEY;
if (referenceResolved(neonKey) === "yes") {
  const projects = await apiStatus(
    "https://console.neon.tech/api/v2/projects",
    {
      Authorization: `Bearer ${neonKey}`,
      Accept: "application/json",
    },
  );
  const rows = projects.payload?.projects ?? [];
  const names = rows
    .map((project) => `${project.id}:${project.name}`)
    .filter((name) => name !== "undefined:undefined");
  const neonError = errorSummary(projects.payload);
  console.log(
    `neon_projects=${probeResult(projects.status)} count=${rows.length} shape=${credentialShape(neonKey)} code=${redact(neonError.code) || "none"} message=${redact(neonError.message) || "none"}`,
  );
  for (const name of names) console.log(`neon_project=${name}`);
  const direct = await apiStatus(
    "https://console.neon.tech/api/v2/projects/mute-credit-71067312",
    {
      Authorization: `Bearer ${neonKey}`,
      Accept: "application/json",
    },
  );
  const directError = errorSummary(direct.payload);
  const directName = direct.payload?.project?.name;
  console.log(
    `neon_known_project=${probeResult(direct.status)} name=${typeof directName === "string" ? directName : "absent"} code=${redact(directError.code) || "none"} message=${redact(directError.message) || "none"}`,
  );
  const known = direct.status === 200;
  if (known) {
    const branches = await apiStatus(
      "https://console.neon.tech/api/v2/projects/mute-credit-71067312/branches",
      {
        Authorization: `Bearer ${neonKey}`,
        Accept: "application/json",
      },
    );
    const branchRows = branches.payload?.branches ?? [];
    console.log(
      `neon_branches=${probeResult(branches.status)} count=${branchRows.length}`,
    );
    for (const branch of branchRows) {
      console.log(
        `neon_branch id=${branch.id} name=${branch.name} parent=${branch.parent_id || "none"}`,
      );
    }
  }
} else {
  console.log("neon_key=skipped");
}
