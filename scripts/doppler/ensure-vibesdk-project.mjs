// Create the empty Doppler project vibesdk when it is missing.
// Prints names only. Does not download, copy, or inherit dyad secrets.

import {
  configReport,
  dyadDevStatus,
  projectBody,
  redact,
  VIBESDK_PROJECT_NAME,
} from "./vibesdk-project.mjs";

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
  return projects;
}

const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
if (!token) {
  console.log("admin_token=absent");
  process.exit(1);
}

const projects = await listProjects(token);
const existing = projects.find(
  (project) => project?.name === VIBESDK_PROJECT_NAME,
);
let created = false;
if (!existing) {
  await doppler(token, "POST", "/v3/projects", projectBody());
  created = true;
}

const environments = await doppler(
  token,
  "GET",
  `/v3/environments?project=${encodeURIComponent(VIBESDK_PROJECT_NAME)}`,
);
const configs = await doppler(
  token,
  "GET",
  `/v3/configs?project=${encodeURIComponent(VIBESDK_PROJECT_NAME)}&page=1&per_page=100`,
);
const dyad = projects.find((project) => project?.name === "dyad");
let dyadConfigs = [];
if (dyad) {
  const listed = await doppler(
    token,
    "GET",
    "/v3/configs?project=dyad&page=1&per_page=100",
  );
  dyadConfigs = listed.configs ?? [];
}

const environmentNames = (environments.environments ?? [])
  .map((item) => item.slug || item.id)
  .filter(Boolean);

console.log(`project=${VIBESDK_PROJECT_NAME}`);
console.log(`project_state=${created ? "created" : "exists"}`);
console.log(`environments=${environmentNames.join(",") || "none"}`);
for (const line of configReport(configs.configs)) {
  console.log(line);
}
console.log(`dyad_dev=${dyadDevStatus(dyadConfigs)}`);
console.log("inherit=no");
console.log("secret_copy=no");
