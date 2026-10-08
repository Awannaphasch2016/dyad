// Copy OPENROUTER_API_KEY from the vibesdk Doppler project into forma/dev.
// Prints names and a shape label only. Does not print secret values and does
// not read a production config.

import { pathToFileURL } from "node:url";

export const SOURCE_PROJECT = "vibesdk";
export const DEST_PROJECT = "forma";
export const DEST_CONFIG = "dev";
export const SECRET_NAME = "OPENROUTER_API_KEY";
export const SOURCE_CONFIG_ORDER = ["dev", "preview", "stg", "canary"];

const OPENAI_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_EXECUTOR_API_KEY",
  "OPENAI_AGENT_ID",
  "OPENAI_WEBHOOK_SECRET",
];

export function secretNames(payload) {
  const secrets = payload?.secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    return [];
  }
  return Object.keys(secrets).filter((name) => !name.startsWith("DOPPLER_"));
}

export function openRouterShape(value) {
  const text = String(value ?? "").trim();
  if (text === "") return "absent";
  if (text.startsWith("${")) return "unresolved";
  if (text.startsWith("sk-or-")) return "openrouter";
  if (text.startsWith("sk-")) return "openai";
  return "other";
}

export function selectOpenRouterSecret(namesByConfig, valuesByConfig) {
  for (const config of SOURCE_CONFIG_ORDER) {
    const names = namesByConfig?.[config] ?? [];
    if (!names.includes(SECRET_NAME)) continue;
    const shape = openRouterShape(valuesByConfig?.[config]?.[SECRET_NAME]);
    if (shape !== "openrouter") {
      return { status: shape, config, secrets: null };
    }
    return {
      status: "ready",
      config,
      secrets: { [SECRET_NAME]: valuesByConfig[config][SECRET_NAME] },
    };
  }
  return { status: "absent", config: "", secrets: null };
}

export function uploadBody(secrets) {
  const names = Object.keys(secrets ?? {});
  if (names.length !== 1 || names[0] !== SECRET_NAME) {
    throw new Error("Refusing to upload anything except OPENROUTER_API_KEY");
  }
  for (const name of OPENAI_NAMES) {
    if (name in secrets) throw new Error(`Refusing to upload ${name}`);
  }
  return {
    project: DEST_PROJECT,
    config: DEST_CONFIG,
    secrets,
  };
}

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .slice(0, 300);
}

async function doppler(token, method, path, body) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    throw new Error(
      `${method} ${path.split("?")[0]} ${response.status} ${redact(payload?.message || text)}`,
    );
  }
  return payload;
}

async function configNames(token, project) {
  const payload = await doppler(
    token,
    "GET",
    `/v3/configs?project=${encodeURIComponent(project)}&page=1&per_page=100`,
  );
  return (payload.configs ?? [])
    .map((config) => String(config?.name ?? ""))
    .filter(Boolean);
}

async function namesFor(token, project, config) {
  const payload = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`,
  );
  return secretNames(payload).sort();
}

async function download(token, project, config) {
  return doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}&format=json`,
  );
}

export async function organizeFormaOpenRouter({
  token = process.env.DOPPLER_ADMIN_TOKEN ?? "",
  request = doppler,
} = {}) {
  if (!token) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exitCode = 1;
    return;
  }
  console.log("DOPPLER_ADMIN_TOKEN=present");

  const configs = await configNames(token, SOURCE_PROJECT);
  console.log(`vibesdk_configs=${configs.join(",") || "none"}`);
  const namesByConfig = {};
  const valuesByConfig = {};
  for (const config of SOURCE_CONFIG_ORDER) {
    if (!configs.includes(config)) {
      console.log(`vibesdk_${config}=absent`);
      continue;
    }
    const names = await namesFor(token, SOURCE_PROJECT, config);
    namesByConfig[config] = names;
    console.log(
      `vibesdk_${config}_openrouter=${names.includes(SECRET_NAME) ? "present" : "absent"}`,
    );
    if (names.includes(SECRET_NAME)) {
      const downloaded = await download(token, SOURCE_PROJECT, config);
      valuesByConfig[config] = { [SECRET_NAME]: downloaded[SECRET_NAME] };
    }
  }
  if (configs.includes("prd")) {
    const prdNames = await namesFor(token, SOURCE_PROJECT, "prd");
    console.log(
      `vibesdk_prd_openrouter=${prdNames.includes(SECRET_NAME) ? "refused" : "absent"}`,
    );
  }

  const selected = selectOpenRouterSecret(namesByConfig, valuesByConfig);
  console.log(
    `openrouter_source=${selected.status}${selected.config ? ` config=${selected.config}` : ""}`,
  );
  if (selected.status !== "ready") {
    process.exitCode = 1;
    return;
  }

  const formaConfigs = await configNames(token, DEST_PROJECT);
  if (!formaConfigs.includes(DEST_CONFIG)) {
    console.log("forma_dev=absent");
    process.exitCode = 1;
    return;
  }
  await request(
    token,
    "POST",
    "/v3/configs/config/secrets",
    uploadBody(selected.secrets),
  );
  console.log("forma_dev_openrouter=uploaded");

  const forma = await download(token, DEST_PROJECT, DEST_CONFIG);
  const shape = openRouterShape(forma[SECRET_NAME]);
  console.log(`forma_dev_openrouter_shape=${shape}`);
  for (const name of OPENAI_NAMES) {
    console.log(
      `forma_dev_${name}=${typeof forma[name] === "string" && forma[name] ? "present" : "absent"}`,
    );
  }
  if (shape !== "openrouter") {
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  organizeFormaOpenRouter().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
