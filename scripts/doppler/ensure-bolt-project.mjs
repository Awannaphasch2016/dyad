// Create Doppler project bolt and reference Cloudflare plus the OpenRouter key.
// Prints names and shapes only. Does not print secret values.

import { pathToFileURL } from "node:url";
import {
  BOLT_PROJECT_NAME,
  VIBESDK_DEV_CONFIG,
  VIBESDK_PROJECT_NAME,
  OPEN_ROUTER_API_KEY,
  boltHitlSecretNames,
  chooseOpenRouterSource,
  cloudflareReferencePlan,
  cloudflareSecrets,
  configReport,
  credentialShape,
  devInheritableBody,
  isProductionConfig,
  openRouterReferencePlan,
  openRouterSearchOrder,
  openRouterSourceNames,
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

async function namedSecrets(token, project, config) {
  const configs = await listConfigs(token, project);
  const names = new Set(configs.map((item) => item?.name).filter(Boolean));
  if (!names.has(config)) return null;
  const payload = await secretPayload(token, project, config);
  return takeSecretNames(payload);
}

async function openRouterPlaces(token, projects) {
  const places = [];
  const seen = new Set();

  async function add(project, config) {
    const key = `${project}.${config}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!projects.includes(project)) {
      places.push({ project, config, names: [], missing: true });
      return;
    }
    try {
      const names = await namedSecrets(token, project, config);
      if (!names) {
        places.push({ project, config, names: [], missing: true });
        return;
      }
      places.push({ project, config, names });
    } catch (error) {
      console.log(
        `openrouter_lookup=${project}.${config} failed ${redact(error?.message || error)}`,
      );
      places.push({ project, config, names: [], missing: true });
    }
  }

  for (const place of openRouterSearchOrder) {
    await add(place.project, place.config);
  }
  for (const project of projects) {
    if (project === BOLT_PROJECT_NAME) continue;
    let configs = [];
    try {
      configs = await listConfigs(token, project);
    } catch (error) {
      console.log(
        `openrouter_lookup=${project} failed ${redact(error?.message || error)}`,
      );
      continue;
    }
    for (const config of configs) {
      const name = String(config?.name ?? "");
      if (!name || isProductionConfig(name)) continue;
      await add(project, name);
    }
  }
  return places;
}

function openRouterCheckLabel(place) {
  if (place.missing) return `${place.project}.${place.config}=unreachable`;
  const name = openRouterSourceNames.find((candidate) =>
    place.names.includes(candidate),
  );
  return `${place.project}.${place.config}=${name ?? "absent"}`;
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

  const places = await openRouterPlaces(token, projects);
  const preferred = places.filter((place) =>
    openRouterSearchOrder.some(
      (wanted) =>
        wanted.project === place.project && wanted.config === place.config,
    ),
  );
  console.log(
    `openrouter_checked=${preferred.map(openRouterCheckLabel).join(",") || "none"}`,
  );
  const found = chooseOpenRouterSource(places);
  if (!found) {
    console.log("openrouter_key=absent");
    process.exit(1);
  }
  const openRouterRoot = await directReference(
    token,
    found.project,
    found.config,
    found.name,
  );
  console.log(`openrouter_source=${openRouterRoot}`);
  const openRouterPlan = openRouterReferencePlan(found, openRouterRoot);
  await doppler(token, "POST", "/v3/configs/config/secrets", {
    project: BOLT_PROJECT_NAME,
    config: "dev",
    secrets: openRouterPlan.secrets,
  });
  console.log(`reference=${openRouterPlan.secrets[OPEN_ROUTER_API_KEY]}`);

  const hitlSearch = [
    ["dyad", "preview"],
    ["dyad", "dev"],
    ["forma", "preview"],
    ["forma", "dev"],
  ];
  for (const name of boltHitlSecretNames) {
    let source = null;
    for (const [project, config] of hitlSearch) {
      if (!projects.includes(project)) continue;
      const names = await namedSecrets(token, project, config);
      if (names?.includes(name)) {
        source = { project, config, name };
        break;
      }
    }
    if (!source) {
      console.log(`hitl_absent=${name}`);
      continue;
    }
    const reference = await directReference(
      token,
      source.project,
      source.config,
      source.name,
    );
    await doppler(token, "POST", "/v3/configs/config/secrets", {
      project: BOLT_PROJECT_NAME,
      config: "dev",
      secrets: { [name]: reference },
    });
    console.log(`hitl_reference=${reference}`);
  }

  configs = await listConfigs(token, BOLT_PROJECT_NAME);
  for (const line of configReport(configs)) console.log(line);

  const preview = await doppler(
    token,
    "GET",
    `/v3/configs/config/secrets/download?project=${BOLT_PROJECT_NAME}&config=preview&format=json`,
  );
  let unresolved = false;
  for (const name of [
    ...cloudflareSecrets.map((wanted) => wanted.dest),
    OPEN_ROUTER_API_KEY,
  ]) {
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
  const productionNames = [
    ...cloudflareSecrets.map((wanted) => wanted.dest),
    OPEN_ROUTER_API_KEY,
    ...boltHitlSecretNames,
  ].filter((name) => referenceResolved(production[name]) !== "absent");
  for (const name of Object.keys(production)) production[name] = undefined;
  if (productionNames.length > 0) {
    console.log(`bolt_prd_secrets=present ${productionNames.join(",")}`);
    process.exit(1);
  }
  console.log("bolt_prd_secrets=absent");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  ensureBoltProject().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
