// Reference the Hut ai-pilot/dev Claude key into vibesdk/dev.
// Prints names and a models-endpoint status. Does not print the key.

import { redact, VIBESDK_PROJECT_NAME } from "./vibesdk-project.mjs";
import {
  chooseProjectReference,
  claudeSourceName,
  credentialShape,
  errorSummary,
  probeResult,
  referenceResolved,
  takeSecretNames,
} from "./vibesdk-references.mjs";

const projectCandidates = ["ai-pilot", "ai_pilot", "aipilot"];

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

async function secretNames(token, project, config) {
  try {
    const payload = await doppler(
      token,
      "GET",
      `/v3/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`,
    );
    return takeSecretNames(payload);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
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

const projects = await listProjects(token);
console.log(`projects=${projects.join(",") || "none"}`);

const hits = [];
for (const name of projects) {
  const listed = await doppler(
    token,
    "GET",
    `/v3/configs?project=${encodeURIComponent(name)}&page=1&per_page=100`,
  );
  const configs = (listed.configs ?? [])
    .map((config) => String(config?.name ?? ""))
    .filter(Boolean);
  console.log(`configs ${name}=${configs.join(",") || "none"}`);
  for (const config of configs) {
    const names = await secretNames(token, name, config);
    if (names == null) continue;
    const source = claudeSourceName(names);
    if (!source) continue;
    hits.push({ project: name, config, source });
    console.log(`claude_hit=${name}/${config} name=${source}`);
  }
}

const preferred =
  hits.find(
    (hit) => projectCandidates.includes(hit.project) && hit.config === "dev",
  ) ?? null;
if (!preferred) {
  console.log(
    `claude_reference=${hits.length === 0 ? "absent" : "not_ai_pilot"}`,
  );
  process.exit(0);
}
const choiceHit = preferred;

const choice = chooseProjectReference(
  choiceHit.project,
  [choiceHit.config],
  { [choiceHit.config]: new Set([choiceHit.source]) },
  [choiceHit.source],
  "ANTHROPIC_API_KEY",
);
await doppler(token, "POST", "/v3/configs/config/secrets", {
  project: VIBESDK_PROJECT_NAME,
  config: "dev",
  secrets: { ANTHROPIC_API_KEY: choice.reference },
});
console.log(`reference=${choice.reference}`);

const downloaded = await doppler(
  token,
  "GET",
  `/v3/configs/config/secrets/download?project=${VIBESDK_PROJECT_NAME}&config=dev&format=json`,
);
const value = downloaded.ANTHROPIC_API_KEY;
mask(value);
console.log(
  `ANTHROPIC_API_KEY=${referenceResolved(value)} shape=${credentialShape(value)}`,
);
if (referenceResolved(value) !== "yes") process.exit(1);

const response = await fetch("https://api.anthropic.com/v1/models", {
  headers: {
    "x-api-key": value,
    "anthropic-version": "2023-06-01",
    Accept: "application/json",
  },
});
const text = await response.text();
let payload = {};
if (text) {
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
}
const summary = errorSummary(payload);
const models = payload?.data ?? [];
const claudeModels = models.filter(
  (model) =>
    typeof model?.id === "string" && model.id.toLowerCase().includes("claude"),
);
console.log(
  `anthropic_models=${probeResult(response.status, payload)} count=${models.length} claude=${claudeModels.length} code=${redact(summary.code) || "none"} message=${redact(summary.message) || "none"}`,
);
