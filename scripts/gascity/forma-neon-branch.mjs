// Create a schema-only Neon branch for forma and store its URL in forma/dev.
// The branch copies schema from the Dyad dev endpoint and copies no rows.
// Prints branch ids and host labels only.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const neonProjectId = "mute-credit-71067312";
export const devEndpointId = "ep-wild-paper-b3yf26si";
export const productionEndpointId = "ep-young-wave-b3cwe0rz";
export const formaBranchName = "forma";
const neonApi = "https://console.neon.tech/api/v2";

const branchPattern = /^br-[a-z0-9-]+$/;

export function branchIdForEndpoint(endpoints, endpointId) {
  if (!Array.isArray(endpoints)) {
    throw new Error("endpoints must be a list");
  }
  const match = endpoints.find((item) => endpointMatches(item, endpointId));
  const branchId = match?.branch_id;
  if (typeof branchId !== "string" || !branchPattern.test(branchId)) {
    throw new Error(`endpoint ${endpointId} has no branch`);
  }
  return branchId;
}

function endpointMatches(item, endpointId) {
  const fields = [item?.id, item?.host, item?.pooler_host];
  return fields.some((value) => {
    if (typeof value !== "string") return false;
    return (
      value === endpointId ||
      value.startsWith(`${endpointId}.`) ||
      value.startsWith(`${endpointId}-pooler`)
    );
  });
}

export function schemaOnlyBranchBody(parentId, name = formaBranchName) {
  if (!branchPattern.test(String(parentId))) {
    throw new Error("schema source branch is invalid");
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) {
    throw new Error("branch name is invalid");
  }
  return {
    branch: {
      parent_id: parentId,
      name,
      init_source: "schema-only",
    },
    endpoints: [{ type: "read_write" }],
  };
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

async function listCollection(apiKey, path, collection) {
  const all = [];
  const seen = new Set();
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
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

async function waitForOperations(apiKey, operations) {
  for (const operation of operations || []) {
    if (!operation?.id) continue;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await neonRequest(
        apiKey,
        `/projects/${neonProjectId}/operations/${operation.id}`,
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

async function connectionUriReady(apiKey, branchId) {
  let lastError = new Error("Neon connection URI was not ready");
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await connectionUri(apiKey, branchId);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!/\b(404|409|423|500|503)\b/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function connectionUri(apiKey, branchId) {
  const params = new URLSearchParams({
    branch_id: branchId,
    database_name: "neondb",
    role_name: "neondb_owner",
    pooled: "true",
  });
  const body = await neonRequest(
    apiKey,
    `/projects/${neonProjectId}/connection_uri?${params}`,
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

async function createFormaBranch() {
  if (!process.env.DOPPLER_TOKEN) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  console.log("DOPPLER_ADMIN_TOKEN=present");
  const apiKey = readApiKey();
  console.log("NEON_API_KEY=present");
  console.log(`neon_project=${neonProjectId}`);

  const endpoints = await listCollection(
    apiKey,
    `/projects/${neonProjectId}/endpoints`,
    "endpoints",
  );
  const parentId = branchIdForEndpoint(endpoints, devEndpointId);
  console.log(`schema_source=${parentId}`);

  const branches = await listCollection(
    apiKey,
    `/projects/${neonProjectId}/branches`,
    "branches",
  );
  let branch = branches.find((item) => item.name === formaBranchName);
  if (branch) {
    console.log("forma_branch=exists");
  } else {
    const created = await neonRequest(
      apiKey,
      `/projects/${neonProjectId}/branches`,
      {
        method: "POST",
        body: schemaOnlyBranchBody(parentId),
      },
    );
    branch = created.branch;
    await waitForOperations(apiKey, created.operations);
    console.log("forma_branch=created");
  }
  if (!branch?.id || !branchPattern.test(branch.id)) {
    throw new Error("forma branch id is missing");
  }
  console.log(`forma_branch_id=${branch.id}`);
  console.log("init_source=schema-only");

  const uri = await connectionUriReady(apiKey, branch.id);
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
  console.log("forma_database=schema-only");
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
