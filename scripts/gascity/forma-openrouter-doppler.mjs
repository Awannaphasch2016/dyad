// Copy OPENROUTER_API_KEY from the vibesdk Doppler project into forma/dev.
// Prints names and a shape label only. Does not print secret values and does
// not read a production config.

import { pathToFileURL } from "node:url";

export const SOURCE_PROJECT = "vibesdk";
export const DEST_PROJECT = "forma";
export const DEST_CONFIG = "dev";
export const SECRET_NAME = "OPENROUTER_API_KEY";
export const DYAD_PROJECT = "dyad";
export const SOURCE_CONFIG_ORDER = [
  "dev",
  "dev_personal",
  "preview",
  "stg",
  "canary",
];
export const DYAD_CONFIG_ORDER = ["dev", "preview", "stg", "canary"];

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

export function selectOpenRouterSecret(
  namesByConfig,
  valuesByConfig,
  order = SOURCE_CONFIG_ORDER,
) {
  for (const config of order) {
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

export function referenceString(project, config, name = SECRET_NAME) {
  if (project === "prd" || config === "prd") {
    throw new Error("Refusing a production reference");
  }
  return `\${${project}.${config}.${name}}`;
}

export function referenceBody(project, config, reference) {
  if (project === "prd" || config === "prd") {
    throw new Error("Refusing a production config");
  }
  if (
    typeof reference !== "string" ||
    !reference.startsWith("${") ||
    reference.includes(".prd.")
  ) {
    throw new Error("Refusing a reference outside a non-production config");
  }
  return {
    project,
    config,
    secrets: { [SECRET_NAME]: reference },
  };
}

export function planOpenRouterCopy({
  vibesdkNamesByConfig,
  vibesdkValuesByConfig,
  dyadNamesByConfig,
  dyadValuesByConfig,
}) {
  const fromVibesdk = selectOpenRouterSecret(
    vibesdkNamesByConfig,
    vibesdkValuesByConfig,
    SOURCE_CONFIG_ORDER,
  );
  if (fromVibesdk.status === "ready") {
    return {
      status: "ready",
      sourceProject: SOURCE_PROJECT,
      sourceConfig: fromVibesdk.config,
      upstream: null,
      secrets: fromVibesdk.secrets,
    };
  }
  if (fromVibesdk.status !== "absent") {
    return {
      status: fromVibesdk.status,
      sourceProject: SOURCE_PROJECT,
      sourceConfig: fromVibesdk.config,
      upstream: null,
      secrets: null,
    };
  }
  const fromDyad = selectOpenRouterSecret(
    dyadNamesByConfig,
    dyadValuesByConfig,
    DYAD_CONFIG_ORDER,
  );
  if (fromDyad.status !== "ready") {
    return {
      status: fromDyad.status,
      sourceProject: DYAD_PROJECT,
      sourceConfig: fromDyad.config,
      upstream: null,
      secrets: null,
    };
  }
  return {
    status: "ready",
    sourceProject: SOURCE_PROJECT,
    sourceConfig: DEST_CONFIG,
    upstream: {
      project: DYAD_PROJECT,
      config: fromDyad.config,
      reference: referenceString(DYAD_PROJECT, fromDyad.config),
    },
    secrets: fromDyad.secrets,
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

function mask(value) {
  const text = String(value ?? "").trim();
  if (text) console.log(`::add-mask::${text}`);
}

async function configNames(request, token, project) {
  const payload = await request(
    token,
    "GET",
    `/v3/configs?project=${encodeURIComponent(project)}&page=1&per_page=100`,
  );
  return (payload.configs ?? [])
    .map((config) => String(config?.name ?? ""))
    .filter(Boolean);
}

async function namesFor(request, token, project, config) {
  const payload = await request(
    token,
    "GET",
    `/v3/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`,
  );
  return secretNames(payload).sort();
}

async function downloadName(request, token, project, config) {
  const downloaded = await request(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}&format=json`,
  );
  const value = downloaded?.[SECRET_NAME];
  mask(value);
  return { [SECRET_NAME]: value };
}

async function collect(request, token, project, order, configs) {
  const namesByConfig = {};
  const valuesByConfig = {};
  for (const config of order) {
    if (!configs.includes(config)) {
      console.log(`${project}_${config}=absent`);
      continue;
    }
    const names = await namesFor(request, token, project, config);
    namesByConfig[config] = names;
    const present = names.includes(SECRET_NAME);
    console.log(
      `${project}_${config}_openrouter=${present ? "present" : "absent"}`,
    );
    if (present) {
      valuesByConfig[config] = await downloadName(
        request,
        token,
        project,
        config,
      );
    }
  }
  return { namesByConfig, valuesByConfig };
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

  const configs = await configNames(request, token, SOURCE_PROJECT);
  console.log(`vibesdk_configs=${configs.join(",") || "none"}`);
  const vibesdk = await collect(
    request,
    token,
    SOURCE_PROJECT,
    SOURCE_CONFIG_ORDER,
    configs,
  );
  if (configs.includes("prd")) {
    const prdNames = await namesFor(request, token, SOURCE_PROJECT, "prd");
    console.log(
      `vibesdk_prd_openrouter=${prdNames.includes(SECRET_NAME) ? "refused" : "absent"}`,
    );
  }

  let dyad = { namesByConfig: {}, valuesByConfig: {} };
  const vibesdkReady = selectOpenRouterSecret(
    vibesdk.namesByConfig,
    vibesdk.valuesByConfig,
  );
  if (vibesdkReady.status === "absent") {
    const dyadConfigs = await configNames(request, token, DYAD_PROJECT);
    console.log(`dyad_configs=${dyadConfigs.join(",") || "none"}`);
    dyad = await collect(
      request,
      token,
      DYAD_PROJECT,
      DYAD_CONFIG_ORDER,
      dyadConfigs,
    );
    if (dyadConfigs.includes("prd")) {
      console.log("dyad_prd=refused");
    }
  }

  const selected = planOpenRouterCopy({
    vibesdkNamesByConfig: vibesdk.namesByConfig,
    vibesdkValuesByConfig: vibesdk.valuesByConfig,
    dyadNamesByConfig: dyad.namesByConfig,
    dyadValuesByConfig: dyad.valuesByConfig,
  });
  if (selected.upstream) {
    console.log(
      `openrouter_upstream=${selected.upstream.project} ${selected.upstream.config}`,
    );
    await request(
      token,
      "POST",
      "/v3/configs/config/secrets",
      referenceBody(SOURCE_PROJECT, DEST_CONFIG, selected.upstream.reference),
    );
    console.log("vibesdk_dev_openrouter=referenced");
    const resolved = await downloadName(
      request,
      token,
      SOURCE_PROJECT,
      DEST_CONFIG,
    );
    selected.secrets = resolved;
  }
  const sourceShape = openRouterShape(selected.secrets?.[SECRET_NAME]);
  const sourceStatus =
    selected.status === "ready" ? sourceShape : selected.status;
  console.log(
    `openrouter_source=${sourceStatus === "openrouter" ? "ready" : sourceStatus}${selected.sourceConfig ? ` config=${selected.sourceConfig}` : ""}`,
  );
  if (selected.status !== "ready" || sourceShape !== "openrouter") {
    process.exitCode = 1;
    return;
  }

  const formaConfigs = await configNames(request, token, DEST_PROJECT);
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

  const formaDownloaded = await request(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${encodeURIComponent(DEST_PROJECT)}&config=${encodeURIComponent(DEST_CONFIG)}&format=json`,
  );
  mask(formaDownloaded?.[SECRET_NAME]);
  const shape = openRouterShape(formaDownloaded?.[SECRET_NAME]);
  console.log(`forma_dev_openrouter_shape=${shape}`);
  for (const name of OPENAI_NAMES) {
    const value = formaDownloaded?.[name];
    mask(value);
    console.log(
      `forma_dev_${name}=${typeof value === "string" && value ? "present" : "absent"}`,
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
