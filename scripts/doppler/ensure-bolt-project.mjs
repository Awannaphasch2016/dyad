// Create Doppler project bolt and reference the vibesdk/dev Cloudflare names.
// Prints names and shapes only. Does not print secret values or read dyad.

import { pathToFileURL } from "node:url";
import {
  BOLT_PROJECT_NAME,
  VIBESDK_DEV_CONFIG,
  VIBESDK_PROJECT_NAME,
  cloudflareReferencePlan,
  cloudflareSecrets,
  configReport,
  credentialShape,
  devInheritableBody,
  parseDopplerReference,
  previewEnvironmentBody,
  previewInheritsBody,
  prdInheritsBody,
  projectBody,
  redact,
  referenceResolved,
  referenceString,
  takeSecretNames,
} from "./bolt-project.mjs";

async function doppler(token, method, path, body) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

async function listProjects(token) {
  const projects = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await doppler(
      token,
      "GET",
      `/v3/projects?page=${page}&per_page=100`,
    );
    const batch = payload.projects ?? [];
    projects.push(...batch);
    if (batch.length < 100) break;
  }
  return projects.map((project) => String(project?.name ?? "")).filter(Boolean);
}

async function listConfigs(token, project) {
  const payload = await doppler(
    token,
    "GET",
    `/v3/configs?project=${encodeURIComponent(project)}&page=1&per_page=100`,
  );
  return payload.configs ?? [];
}

async function secretPayload(token, project, config) {
  return doppler(
    token,
    "GET",
    `/v3/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`,
  );
}

async function directReference(token, project, config, name, depth = 0) {
  const payload = await secretPayload(token, project, config);
  const entry = payload.secrets?.[name];
  const parsed = parseDopplerReference(
    entry && typeof entry === "object" ? entry.raw : undefined,
  );
  if (entry && typeof entry === "object") {
    entry.raw = undefined;
    entry.computed = undefined;
    entry.value = undefined;
  }
  if (!parsed) return referenceString(project, config, name);
  if (depth >= 4) {
    console.log(`reference_chain=${project}.${config}.${name}`);
    process.exit(1);
  }
  return directReference(
    token,
    parsed.project,
    parsed.config,
    parsed.name,
    depth + 1,
  );
}

function mask(value) {
  if (typeof value === "string" && value.length > 0) {
    console.log(`::add-mask::${value}`);
  }
}

async function ensureBoltProject() {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    console.log("admin_token=absent");
    process.exit(1);
  }
  console.log("admin_token=present");

  const projects = await listProjects(token);
  if (!projects.includes(VIBESDK_PROJECT_NAME)) {
    console.log(`source_project=${VIBESDK_PROJECT_NAME} state=absent`);
    process.exit(1);
  }

  let created = false;
  if (!projects.includes(BOLT_PROJECT_NAME)) {
    await doppler(token, "POST", "/v3/projects", projectBody());
    created = true;
  }
  console.log(`project=${BOLT_PROJECT_NAME}`);
  console.log(`project_state=${created ? "created" : "exists"}`);

  await doppler(
    token,
    "POST",
    "/v3/configs/config/inheritable",
    devInheritableBody(),
  );
  console.log("bolt_dev_inheritable=yes");

  let configs = await listConfigs(token, BOLT_PROJECT_NAME);
  const names = new Set(configs.map((config) => config?.name).filter(Boolean));
  if (!names.has("dev") || !names.has("prd")) {
    console.log(`bolt_root_configs=${[...names].sort().join(",") || "none"}`);
    process.exit(1);
  }
  if (!names.has("preview")) {
    await doppler(
      token,
      "POST",
      `/v3/environments?project=${encodeURIComponent(BOLT_PROJECT_NAME)}`,
      previewEnvironmentBody(),
    );
    console.log("bolt_preview=created");
  } else {
    console.log("bolt_preview=exists");
  }

  await doppler(
    token,
    "POST",
    "/v3/configs/config/inherits",
    previewInheritsBody(),
  );
  await doppler(
    token,
    "POST",
    "/v3/configs/config/inherits",
    prdInheritsBody(),
  );
  console.log("bolt_preview_inherits=bolt.dev");
  console.log("bolt_prd_inherits=none");

  const sourcePayload = await secretPayload(
    token,
    VIBESDK_PROJECT_NAME,
    VIBESDK_DEV_CONFIG,
  );
  const sourceNames = takeSecretNames(sourcePayload);
  const roots = {};
  for (const wanted of cloudflareSecrets) {
    const source = wanted.sources.find((name) => sourceNames.includes(name));
    if (!source) continue;
    roots[wanted.dest] = await directReference(
      token,
      VIBESDK_PROJECT_NAME,
      VIBESDK_DEV_CONFIG,
      source,
    );
  }
  const plan = cloudflareReferencePlan(sourceNames, roots);
  console.log(
    `vibesdk_dev_cloudflare=${cloudflareSecrets
      .map((wanted) => {
        const source = wanted.sources.find((name) =>
          sourceNames.includes(name),
        );
        return source ? `${wanted.dest}<=${source}` : `${wanted.dest}=absent`;
      })
      .join(",")}`,
  );
  if (plan.missing.length > 0) {
    console.log(`reference_missing=${plan.missing.join(",")}`);
    process.exit(1);
  }

  await doppler(token, "POST", "/v3/configs/config/secrets", {
    project: BOLT_PROJECT_NAME,
    config: "dev",
    secrets: plan.secrets,
  });
  for (const reference of Object.values(plan.secrets)) {
    console.log(`reference=${reference}`);
  }

  configs = await listConfigs(token, BOLT_PROJECT_NAME);
  for (const line of configReport(configs)) console.log(line);

  const preview = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${BOLT_PROJECT_NAME}&config=preview&format=json`,
  );
  let unresolved = false;
  for (const name of cloudflareSecrets.map((wanted) => wanted.dest)) {
    const value = preview[name];
    mask(value);
    const state = referenceResolved(value);
    console.log(`${name}=${state} shape=${credentialShape(value)}`);
    if (state !== "yes") unresolved = true;
    preview[name] = undefined;
  }
  if (unresolved) process.exit(1);

  const production = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${BOLT_PROJECT_NAME}&config=prd&format=json`,
  );
  const productionNames = cloudflareSecrets
    .map((wanted) => wanted.dest)
    .filter((name) => referenceResolved(production[name]) !== "absent");
  for (const name of Object.keys(production)) production[name] = undefined;
  if (productionNames.length > 0) {
    console.log(`bolt_prd_cloudflare=present ${productionNames.join(",")}`);
    process.exit(1);
  }
  console.log("bolt_prd_cloudflare=absent");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureBoltProject().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
