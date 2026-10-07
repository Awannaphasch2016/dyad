// Create an empty Neon project named forma and store its URL in forma/dev.
// Wewebplus-hitl cannot take another root branch, so forma is not a child of
// the Dyad dev branch and starts with no Dyad rows. Prints ids and host
// labels only.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const orgLookupProjectId = "mute-credit-71067312";
export const devEndpointId = "ep-wild-paper-b3yf26si";
export const productionEndpointId = "ep-young-wave-b3cwe0rz";
const neonApi = "https://console.neon.tech/api/v2";

const branchPattern = /^br-[a-z0-9-]+$/;

export function formaProjectBody(orgId) {
  if (typeof orgId !== "string" || !orgId.startsWith("org-")) {
    throw new Error("neon org id is missing");
  }
  return {
    project: {
      name: "forma",
      org_id: orgId,
      region_id: "aws-ap-southeast-1",
      pg_version: 17,
    },
  };
}

export function defaultBranchId(branches) {
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new Error("forma project has no branch");
  }
  const found =
    branches.find((item) => item.default === true || item.primary === true) ||
    branches[0];
  if (!branchPattern.test(found?.id || "")) {
    throw new Error("forma branch id is missing");
  }
  return found.id;
}

export function formaHostLabel(hostname) {
  const label = String(hostname || "").split(".")[0];
  const bare = label.replace(/-pooler$/, "");
  if (!bare.startsWith("ep-")) {
    throw new Error("forma host is missing");
  }
  if (bare === devEndpointId || bare === productionEndpointId) {
    throw new Error("forma host is still a dyad endpoint");
  }
  return label;
}

function scrub(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .slice(0, 500);
}

function doppler(args) {
  try {
    return execFileSync("doppler", args, {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = scrub(error.stderr || "");
    const stdout = scrub(error.stdout || "");
    console.log(`doppler_failed ${args.join(" ")}`);
    if (stderr) console.log(stderr);
    if (stdout) console.log(stdout);
    process.exit(1);
  }
}

function neonRequest(apiKey, path, options = {}) {
  return fetch(`${neonApi}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(async (response) => {
    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: scrub(text) };
      }
    }
    if (!response.ok) {
      const message = scrub(body.message || "");
      const method = options.method || "GET";
      throw new Error(`${method} ${response.status} ${message}`);
    }
    return body;
  });
}

async function listCollection(apiKey, path, collection, query = {}) {
  const all = [];
  const seen = new Set();
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "100", ...query });
    if (cursor) params.set("cursor", cursor);
    const body = await neonRequest(apiKey, `${path}?${params}`);
    const batch = body[collection];
    if (!Array.isArray(batch)) {
      throw new Error(`${collection} missing`);
    }
    all.push(...batch);
    const next = body.pagination?.cursor || "";
    if (!next || seen.has(next) || batch.length < 100) break;
    seen.add(next);
    cursor = next;
  }
  return all;
}

async function waitForOperations(apiKey, projectId, operations) {
  for (const operation of operations || []) {
    if (!operation?.id) continue;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await neonRequest(
        apiKey,
        `/projects/${projectId}/operations/${operation.id}`,
      );
      const status = current.operation?.status;
      if (status === "finished") break;
      if (status === "failed" || status === "cancelled") {
        throw new Error(`Neon operation ${status}`);
      }
      if (attempt === 39) throw new Error("Neon operation timed out");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function connectionUriReady(apiKey, projectId, branchId) {
  let lastError = new Error("Neon connection URI was not ready");
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await connectionUri(apiKey, projectId, branchId);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!/\b(404|409|423|500|503)\b/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function connectionUri(apiKey, projectId, branchId) {
  const params = new URLSearchParams({
    branch_id: branchId,
    database_name: "neondb",
    role_name: "neondb_owner",
    pooled: "true",
  });
  const body = await neonRequest(
    apiKey,
    `/projects/${projectId}/connection_uri?${params}`,
  );
  if (typeof body.uri !== "string" || !/^postgres(ql)?:\/\//.test(body.uri)) {
    throw new Error("Neon did not return a connection URI");
  }
  return body.uri;
}

function uploadDatabaseUrl(uri) {
  const dir = mkdtempSync(join(tmpdir(), "forma-neon-"));
  const file = join(dir, "secrets.json");
  try {
    writeFileSync(file, JSON.stringify({ WEWEBPLUS_DATABASE_URL: uri }), {
      mode: 0o600,
    });
    doppler([
      "secrets",
      "upload",
      "--silent",
      "-p",
      "forma",
      "-c",
      "dev",
      file,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readApiKey() {
  const raw = doppler([
    "secrets",
    "download",
    "--silent",
    "--no-file",
    "--format",
    "json",
    "-p",
    "forma",
    "-c",
    "dev",
  ]);
  const parsed = JSON.parse(raw);
  const apiKey = parsed.NEON_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("NEON_API_KEY absent");
  }
  return apiKey;
}

async function branchesReady(apiKey, projectId) {
  let branches = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    branches = await listCollection(
      apiKey,
      `/projects/${projectId}/branches`,
      "branches",
    );
    if (branches.length > 0) return branches;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return branches;
}

async function neonOrgId(apiKey) {
  const body = await neonRequest(apiKey, `/projects/${orgLookupProjectId}`);
  const orgId = body.project?.org_id;
  if (typeof orgId !== "string" || !orgId.startsWith("org-")) {
    throw new Error("neon org id is missing");
  }
  return orgId;
}

async function ensureFormaProject(apiKey) {
  const orgId = await neonOrgId(apiKey);
  console.log(`neon_org=${orgId}`);
  const projects = await listCollection(apiKey, "/projects", "projects", {
    org_id: orgId,
  });
  const existing = projects.find((item) => item.name === "forma");
  if (typeof existing?.id === "string" && existing.id.length > 0) {
    console.log("forma_neon_project=exists");
    console.log(`neon_project=${existing.id}`);
    return existing.id;
  }
  const created = await neonRequest(apiKey, "/projects", {
    method: "POST",
    body: formaProjectBody(orgId),
  });
  const projectId = created.project?.id;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new Error("forma project id is missing");
  }
  await waitForOperations(apiKey, projectId, created.operations);
  console.log("forma_neon_project=created");
  console.log(`neon_project=${projectId}`);
  return projectId;
}

async function createFormaBranch() {
  if (!process.env.DOPPLER_TOKEN) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  console.log("DOPPLER_ADMIN_TOKEN=present");
  const apiKey = readApiKey();
  console.log("NEON_API_KEY=present");
  const projectId = await ensureFormaProject(apiKey);
  const branches = await branchesReady(apiKey, projectId);
  const branchId = defaultBranchId(branches);
  console.log(`forma_branch_id=${branchId}`);
  console.log("forma_rows=empty");

  const uri = await connectionUriReady(apiKey, projectId, branchId);
  const host = new URL(uri).hostname;
  const label = formaHostLabel(host);
  uploadDatabaseUrl(uri);

  const saved = doppler([
    "secrets",
    "download",
    "--silent",
    "--no-file",
    "--format",
    "json",
    "-p",
    "forma",
    "-c",
    "dev",
  ]);
  const savedUrl = JSON.parse(saved).WEWEBPLUS_DATABASE_URL || "";
  const savedHost = new URL(savedUrl).hostname;
  const savedLabel = formaHostLabel(savedHost);
  if (savedLabel !== label) {
    throw new Error("forma database host did not stick");
  }
  console.log(`forma_db_endpoint=${savedLabel}`);
  console.log("forma_rows=not_copied");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  createFormaBranch().catch((error) => {
    const message =
      error instanceof Error ? error.message : "forma branch failed";
    console.log(scrub(message));
    process.exit(1);
  });
}
