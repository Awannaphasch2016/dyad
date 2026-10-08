// Create one Forma Vercel preview and one Neon branch for one pull request.
// Prints names, hosts, and the preview URL. Does not print secret values.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FORMA_NEON_PROJECT_ID = "divine-credit-21002460";
export const FORMA_PARENT_BRANCH_ID = "br-round-night-b33xeq5p";
export const FORMA_REPOSITORY = "Awannaphasch2016/forma";
export const WALKTHROUGH_BRANCH = "cursor/forma-preview-walkthrough";

const REFUSED = [
  "mute-credit-71067312",
  "proud-salad-68182047",
  "br-mute-shadow-b3jxqoho",
  "ep-young-wave-b3cwe0rz",
  "preview-pr-",
];

const OPENAI_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_EXECUTOR_API_KEY",
  "OPENAI_AGENT_ID",
  "OPENAI_WEBHOOK_SECRET",
];

const DYAD_VERCEL_PROJECT = "dyad";
const FORMA_VERCEL_NAMES = ["forma", "openai-agents-api-v0-clone"];

export const VERCEL_TOKEN_SOURCES = [
  ["dyad", "preview"],
  ["dyad", "dev"],
  ["dyad", "stg"],
  ["dyad", "canary"],
  ["vibesdk", "dev"],
  ["ai-pilot", "dev"],
];

export function selectVercelProject(projects, projectId = "") {
  const list = Array.isArray(projects) ? projects : [];
  if (projectId) {
    const match = list.find((item) => item.id === projectId);
    if (match?.name === DYAD_VERCEL_PROJECT) {
      throw new Error("Refusing to deploy Forma into the dyad Vercel project");
    }
    if (match) return match;
  }
  for (const name of FORMA_VERCEL_NAMES) {
    const named = list.find((item) => item.name === name);
    if (named) return named;
  }
  const others = list.filter((item) => item.name !== DYAD_VERCEL_PROJECT);
  if (list.length === 1 && others.length === 1) return others[0];
  if (list.length > 0 && others.length === 0) {
    throw new Error("Vercel token only sees the dyad project");
  }
  return null;
}

export function includeDeploymentFile(relative) {
  const parts = String(relative).split(/[/\\]/).filter(Boolean);
  if (
    parts.some(
      (part) =>
        part === "node_modules" ||
        part === ".git" ||
        part === ".next" ||
        part === ".vercel",
    )
  ) {
    return false;
  }
  const base = parts[parts.length - 1] || "";
  if (base === ".env" || base.startsWith(".env.")) return false;
  return true;
}

export function previewVariablePayload(key, value) {
  if (OPENAI_NAMES.includes(key)) throw new Error(`Refusing to upload ${key}`);
  if (!value) throw new Error(`Refusing an empty ${key}`);
  return { key, value, type: "encrypted", target: ["preview"] };
}

export function sourceDeploymentBody(project, files) {
  if (!project?.id || project.name === DYAD_VERCEL_PROJECT) {
    throw new Error("Refusing to deploy Forma into the dyad Vercel project");
  }
  return {
    name: project.name,
    project: project.id,
    files,
    projectSettings: {
      framework: "nextjs",
      installCommand: "pnpm install --frozen-lockfile",
      buildCommand: "pnpm vercel-build",
      nodeVersion: "24.x",
    },
  };
}

export function formaBranchName(pr) {
  if (!/^[0-9]+$/.test(String(pr))) {
    throw new Error("Pull request number must be digits");
  }
  return `forma-pr-${pr}`;
}

export function assertFormaTarget(projectId, parentId) {
  const text = `${projectId} ${parentId}`;
  for (const marker of REFUSED) {
    if (text.includes(marker)) {
      throw new Error("Refusing a Dyad or production database target");
    }
  }
  if (projectId !== FORMA_NEON_PROJECT_ID) {
    throw new Error("Refusing a Neon project other than forma");
  }
  if (parentId !== FORMA_PARENT_BRANCH_ID) {
    throw new Error("Refusing a parent other than the Forma root branch");
  }
}

export function withDeploymentHostOrigin(source) {
  const replacement = `export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpError(403, "Request origin is not allowed.");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Request origin is not allowed.");
  }
  const requestHost = new URL(request.url).host;
  const headerHost = request.headers.get("host")?.split(",")[0]?.trim();
  if (originHost === requestHost || (headerHost && originHost === headerHost)) {
    return;
  }
  const appUrl = process.env.APP_URL;
  if (appUrl && origin === new URL(appUrl).origin) return;
  throw new HttpError(403, "Request origin is not allowed.");
}`;
  if (source.includes("originHost === requestHost")) return source;
  const pattern =
    /export function sameOrigin\(request: Request\) \{\n {2}const expected = process\.env\.APP_URL[\s\S]*?\n\}/;
  if (!pattern.test(source)) {
    throw new Error("Forma sameOrigin function was not found");
  }
  return source.replace(pattern, replacement);
}

export function withDeploymentHostOriginTest(source) {
  const addition = `  it("allows the deployment host when APP_URL names another origin", () => {
    vi.stubEnv("APP_URL", "https://forma-preview.vercel.app");
    expect(() =>
      sameOrigin(
        new Request("https://forma-abc.vercel.app/api/auth", {
          headers: { origin: "https://forma-abc.vercel.app" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://forma-abc.vercel.app/api/auth", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    vi.unstubAllEnvs();
  });
`;
  if (source.includes("allows the deployment host")) return source;
  const marker =
    '  it("routes only executor connection and failure lifecycle webhooks"';
  if (!source.includes(marker)) {
    throw new Error("Forma origin test anchor was not found");
  }
  return source.replace(marker, `${addition}${marker}`);
}

export function previewEnv({ pooledUrl, directUrl, secrets }) {
  assertSafeUrl(pooledUrl, true);
  assertSafeUrl(directUrl, false);
  const shared = {
    APP_PASSWORD: secrets.APP_PASSWORD,
    AUTH_SECRET: secrets.AUTH_SECRET,
    CRON_SECRET: secrets.CRON_SECRET,
    OPENROUTER_API_KEY: secrets.OPENROUTER_API_KEY,
  };
  for (const name of OPENAI_NAMES) {
    if (shared[name]) throw new Error(`Refusing to upload ${name}`);
  }
  return {
    runtime: { ...shared, DATABASE_URL: pooledUrl },
    build: { ...shared, DATABASE_URL: directUrl },
  };
}

export function assertPreviewEnvironment(environment = "preview") {
  const value = String(environment ?? "").trim() || "preview";
  if (value !== "preview") {
    throw new Error("Only the preview environment is implemented");
  }
  return "preview";
}

export function requestedFormaSha(value = "") {
  const sha = String(value ?? "").trim();
  if (!sha) return "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Forma commit SHA must be 40 hex characters");
  }
  return sha;
}

export function formaImageTag(sha) {
  const resolved = requestedFormaSha(sha);
  if (!resolved) {
    throw new Error("Forma commit SHA must be 40 hex characters");
  }
  return `ghcr.io/awannaphasch2016/forma:sha-${resolved}`;
}

export function assertFormaCommitSource(httpText, editorText) {
  const http = String(httpText || "");
  const editor = String(editorText || "");
  return (
    http.includes("originHost === requestHost") &&
    editor.includes("openrouter.ai/api/v1")
  );
}

export function formaPreviewComment(url, sha) {
  return `Forma preview: ${url}\n\nCommit: ${sha}\n\nImage: ${formaImageTag(sha)}`;
}

export function resolveFormaPreviewTarget({
  sha = "",
  pr = "",
  headSha = "",
} = {}) {
  const pull = String(pr ?? "").trim();
  const requested = requestedFormaSha(sha);
  if (pull && !/^[0-9]+$/.test(pull)) {
    throw new Error("Pull request number must be digits");
  }
  if (!pull && !requested) {
    throw new Error("A Forma commit SHA or pull request number is required");
  }
  if (pull) {
    const head = requestedFormaSha(headSha);
    if (!head) {
      throw new Error("Forma pull request head SHA must be 40 hex characters");
    }
    if (requested && requested !== head) {
      throw new Error("Forma commit SHA does not match the pull request head");
    }
    return { pr: pull, sha: head, comment: true };
  }
  return { pr: "", sha: requested, comment: false };
}

export function dockerignoreWithSecretsExcluded(current) {
  const required = [".env", ".env.*", ".git", "node_modules", ".next"];
  const lines = String(current ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let changed = current === null || current === undefined;
  for (const line of required) {
    if (!lines.includes(line)) {
      lines.push(line);
      changed = true;
    }
  }
  if (!changed) return null;
  return `${lines.join("\n")}\n`;
}

export function formaDockerfile() {
  return `FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
EXPOSE 3000
CMD ["pnpm", "start"]
`;
}

function assertSafeUrl(url, pooled) {
  const host = new URL(url).hostname;
  if (host.includes("ep-young-wave") || host.includes("ep-wild-paper")) {
    throw new Error("Refusing a Dyad or production database host");
  }
  if (pooled !== host.includes("-pooler")) {
    throw new Error("Database host does not match the requested pool mode");
  }
}

function redact(text) {
  return String(text)
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "private-key-redacted",
    )
    .replace(/MII[A-Za-z0-9+/=]{16,}/g, "pem-redacted")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .replace(/\bghs_[A-Za-z0-9_]+/g, "ghs_redacted")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "github_pat_redacted")
    .replace(/x-access-token:[^@\s]+/g, "x-access-token:redacted")
    .replace(/\bvcp_[A-Za-z0-9_-]+/g, "vcp_redacted")
    .slice(0, 900);
}

export function secretMaskLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && !line.includes("\n"));
}

function mask(value) {
  for (const line of secretMaskLines(value)) {
    process.stdout.write(`::add-mask::${line}\n`);
  }
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

async function neon(apiKey, method, path, body) {
  const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0] || ""} ${result.status} ${redact(result.stderr || result.stdout)}`,
    );
  }
  return result.stdout || "";
}

async function ensureSecrets(token) {
  const downloaded = await doppler(
    token,
    "GET",
    "/v3/configs/config/secrets/download?project=forma&config=dev&format=json",
  );
  for (const value of Object.values(downloaded)) mask(value);
  const multiline = Object.entries(downloaded)
    .filter(([, value]) => /\r?\n/.test(String(value ?? "")))
    .map(([name]) => name);
  if (multiline.length > 0) {
    console.log(`forma_dev_multiline_secret_names=${multiline.join(",")}`);
  }
  const generated = {};
  for (const name of ["APP_PASSWORD", "AUTH_SECRET", "CRON_SECRET"]) {
    if (!String(downloaded[name] ?? "").trim()) {
      generated[name] = randomBytes(24).toString("base64url");
      mask(generated[name]);
    }
  }
  if (Object.keys(generated).length > 0) {
    await doppler(token, "POST", "/v3/configs/config/secrets", {
      project: "forma",
      config: "dev",
      secrets: generated,
    });
    console.log(`forma_dev_generated=${Object.keys(generated).join(",")}`);
  }
  return { ...downloaded, ...generated };
}

async function waitForOperations(apiKey, operations) {
  for (const operation of operations || []) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await neon(
        apiKey,
        "GET",
        `/projects/${FORMA_NEON_PROJECT_ID}/operations/${operation.id}`,
      );
      const status = current.operation?.status;
      if (status === "finished") break;
      if (status === "failed" || status === "cancelled") {
        throw new Error(`Neon operation ${status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function connectionUri(apiKey, branchId, pooled) {
  const params = new URLSearchParams({
    branch_id: branchId,
    database_name: "neondb",
    role_name: "neondb_owner",
    pooled: pooled ? "true" : "false",
  });
  const body = await neon(
    apiKey,
    "GET",
    `/projects/${FORMA_NEON_PROJECT_ID}/connection_uri?${params}`,
  );
  const uri = body.uri;
  if (!uri || !/^postgres(?:ql)?:\/\//.test(uri)) {
    throw new Error("Neon did not return a connection URI");
  }
  mask(uri);
  const host = new URL(uri).hostname;
  if (REFUSED.some((marker) => host.includes(marker))) {
    throw new Error("Refusing a Dyad or production database host");
  }
  return { uri, host };
}

async function ensureNeonBranch(apiKey, pr) {
  assertFormaTarget(FORMA_NEON_PROJECT_ID, FORMA_PARENT_BRANCH_ID);
  const name = formaBranchName(pr);
  const listed = await neon(
    apiKey,
    "GET",
    `/projects/${FORMA_NEON_PROJECT_ID}/branches`,
  );
  let branch = (listed.branches || []).find((item) => item.name === name);
  if (!branch) {
    const created = await neon(
      apiKey,
      "POST",
      `/projects/${FORMA_NEON_PROJECT_ID}/branches`,
      {
        branch: {
          parent_id: FORMA_PARENT_BRANCH_ID,
          name,
          init_source: "schema-only",
        },
        endpoints: [{ type: "read_write" }],
      },
    );
    branch = created.branch;
    await waitForOperations(apiKey, created.operations);
    console.log(`forma_branch=created ${name}`);
  } else {
    console.log(`forma_branch=present ${name}`);
  }
  if (branch.id === FORMA_PARENT_BRANCH_ID) {
    throw new Error("Refusing to use the parent branch as the preview");
  }
  const pooled = await connectionUri(apiKey, branch.id, true);
  const direct = await connectionUri(apiKey, branch.id, false);
  console.log(`forma_migrate_host=${direct.host}`);
  console.log(`forma_runtime_host=${pooled.host}`);
  return { name, pooled: pooled.uri, direct: direct.uri };
}

function gh(args, input) {
  return run("gh", args, { input });
}

export function openRouterOverlayRoot() {
  return fileURLToPath(new URL("./forma-openrouter/", import.meta.url));
}

export async function openRouterOverlayFiles(root = openRouterOverlayRoot()) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        files.push(relative(root, full).replaceAll("\\", "/"));
      }
    }
  }
  await walk(root);
  return files.sort();
}

export async function applyOpenRouterOverlay(
  checkout,
  root = openRouterOverlayRoot(),
) {
  const files = await openRouterOverlayFiles(root);
  for (const file of files) {
    const target = join(checkout, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  return files;
}

async function publishFormaCommit(checkout, files, message) {
  // git push has no credential for the private Forma repo. The app token can
  // write the commit through the Git Data API instead.
  const head = JSON.parse(
    gh([
      "api",
      `repos/${FORMA_REPOSITORY}/git/ref/heads/${WALKTHROUGH_BRANCH}`,
    ]),
  );
  const parent = head.object.sha;
  const parentCommit = JSON.parse(
    gh(["api", `repos/${FORMA_REPOSITORY}/git/commits/${parent}`]),
  );
  const tree = [];
  for (const file of files) {
    const content = await readFile(join(checkout, file));
    const blob = JSON.parse(
      gh(
        [
          "api",
          "--method",
          "POST",
          `repos/${FORMA_REPOSITORY}/git/blobs`,
          "--input",
          "-",
        ],
        JSON.stringify({
          content: content.toString("base64"),
          encoding: "base64",
        }),
      ),
    );
    tree.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
  }
  const created = JSON.parse(
    gh(
      [
        "api",
        "--method",
        "POST",
        `repos/${FORMA_REPOSITORY}/git/trees`,
        "--input",
        "-",
      ],
      JSON.stringify({ base_tree: parentCommit.tree.sha, tree }),
    ),
  );
  if (created.sha === parentCommit.tree.sha) return "";
  const commit = JSON.parse(
    gh(
      [
        "api",
        "--method",
        "POST",
        `repos/${FORMA_REPOSITORY}/git/commits`,
        "--input",
        "-",
      ],
      JSON.stringify({
        message,
        tree: created.sha,
        parents: [parent],
      }),
    ),
  );
  gh(
    [
      "api",
      "--method",
      "PATCH",
      `repos/${FORMA_REPOSITORY}/git/refs/heads/${WALKTHROUGH_BRANCH}`,
      "--input",
      "-",
    ],
    JSON.stringify({ sha: commit.sha }),
  );
  return commit.sha;
}

function formaImageWorkflowPath() {
  return fileURLToPath(
    new URL("../../deploy/forma/publish-image.yml", import.meta.url),
  );
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sameText(left, right) {
  return (
    String(left).replace(/\r\n/g, "\n") === String(right).replace(/\r\n/g, "\n")
  );
}

async function bootstrapFormaImage(checkout, branchTip) {
  if (!branchTip) {
    console.log("forma_image_workflow=skipped");
    return "";
  }
  const workflowText = await readFile(formaImageWorkflowPath(), "utf8");
  const updates = [];
  const workflowPath = ".github/workflows/publish-image.yml";
  const currentWorkflow = await readOptional(join(checkout, workflowPath));
  if (currentWorkflow === null || !sameText(currentWorkflow, workflowText)) {
    updates.push({ path: workflowPath, text: workflowText });
  }
  const ignorePath = ".dockerignore";
  const currentIgnore = await readOptional(join(checkout, ignorePath));
  const nextIgnore = dockerignoreWithSecretsExcluded(currentIgnore);
  if (nextIgnore !== null) {
    updates.push({ path: ignorePath, text: nextIgnore });
  }
  const dockerPath = "Dockerfile";
  const currentDocker = await readOptional(join(checkout, dockerPath));
  if (currentDocker === null) {
    updates.push({ path: dockerPath, text: formaDockerfile() });
    console.log("forma_dockerfile=added");
  } else {
    console.log("forma_dockerfile=present");
  }
  if (updates.length === 0) {
    console.log("forma_image_workflow=present");
    return "";
  }
  const previous = new Map();
  for (const update of updates) {
    previous.set(update.path, await readOptional(join(checkout, update.path)));
    await mkdir(dirname(join(checkout, update.path)), { recursive: true });
    await writeFile(join(checkout, update.path), update.text);
  }
  try {
    const sha = await publishFormaCommit(
      checkout,
      updates.map((update) => update.path),
      "Publish the Forma image for this commit.",
    );
    console.log(
      sha ? "forma_image_workflow=committed" : "forma_image_workflow=present",
    );
    return sha;
  } catch (error) {
    for (const [path, text] of previous) {
      const full = join(checkout, path);
      if (text === null) await rm(full, { force: true });
      else await writeFile(full, text);
    }
    console.log(`forma_image_workflow=unavailable ${redact(error.message)}`);
    return "";
  }
}

async function cloneWalkthrough(requestedSha) {
  const checkout = await mkdtemp(join(tmpdir(), "forma-preview-"));
  run("gh", [
    "repo",
    "clone",
    FORMA_REPOSITORY,
    checkout,
    "--",
    "--depth",
    "1",
    "--branch",
    WALKTHROUGH_BRANCH,
  ]);
  let sha = run("git", ["rev-parse", "HEAD"], { cwd: checkout }).trim();
  if (!requestedSha || requestedSha === sha) {
    return { checkout, sha, branchTip: true };
  }
  run("git", ["fetch", "--depth", "1", "origin", requestedSha], {
    cwd: checkout,
  });
  run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: checkout });
  sha = run("git", ["rev-parse", "HEAD"], { cwd: checkout }).trim();
  if (sha !== requestedSha) {
    throw new Error("Forma checkout did not match the requested commit");
  }
  return { checkout, sha, branchTip: false };
}

async function requireFormaCommitSource(checkout) {
  const http = (await readOptional(join(checkout, "lib/http.ts"))) || "";
  const editor =
    (await readOptional(join(checkout, "lib/openrouter.ts"))) || "";
  if (!assertFormaCommitSource(http, editor)) {
    throw new Error(
      "Forma commit does not contain the sign-in check and OpenRouter editor",
    );
  }
}

async function migrate(directUrl) {
  const requested = requestedFormaSha(process.env.FORMA_SHA);
  const cloned = await cloneWalkthrough(requested);
  await requireFormaCommitSource(cloned.checkout);
  const committed = await bootstrapFormaImage(
    cloned.checkout,
    cloned.branchTip,
  );
  const sha = committed || cloned.sha;
  console.log(`forma_sha=${sha}`);
  console.log("forma_source=commit");
  run("corepack", ["enable"], { cwd: cloned.checkout });
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: cloned.checkout });
  const envFile = join(cloned.checkout, ".env.local");
  await writeFile(envFile, `DATABASE_URL=${directUrl}\n`);
  const output = run("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
    cwd: cloned.checkout,
    env: { DATABASE_URL: directUrl },
  });
  if (!output.includes("Database schema ready.")) {
    throw new Error("Database schema was not ready");
  }
  console.log("forma_migrate=ready");
  return { checkout: cloned.checkout, sha };
}

async function probeStatus(url) {
  let failure = "Preview is not configured for OpenRouter";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`${url}/api/status`);
    const body = await response.json().catch(() => ({}));
    console.log(
      `forma_status=${response.status} configured=${body.configured === true} provider=${body.provider || "absent"}`,
    );
    if (body.configured === true && body.provider === "openrouter") return;
    failure = `Preview is not configured for OpenRouter (${response.status})`;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(failure);
}

async function probeSignIn(url) {
  const response = await fetch(`${url}/api/auth`, {
    method: "POST",
    headers: {
      origin: url,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: "invalid" }),
  });
  const text = await response.text();
  console.log(`forma_auth_probe=${response.status}`);
  if (response.status !== 401) {
    throw new Error(
      `Sign-in origin check failed ${response.status} ${redact(text)}`,
    );
  }
}

async function vercelApi(token, method, path, body) {
  const response = await fetch(`https://api.vercel.com${path}`, {
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
      `${method} ${path.split("?")[0]} ${response.status} ${redact(payload?.error?.message || payload?.message || text)}`,
    );
  }
  return payload;
}

async function projectList(token, teamId) {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const listed = await vercelApi(token, "GET", `/v9/projects${query}`);
  return listed.projects || [];
}

async function ensureVercelProject(token, existing = {}) {
  if (existing.projectId) {
    const query = existing.orgId
      ? `?teamId=${encodeURIComponent(existing.orgId)}`
      : "";
    try {
      const project = await vercelApi(
        token,
        "GET",
        `/v9/projects/${encodeURIComponent(existing.projectId)}${query}`,
      );
      if (project?.name === DYAD_VERCEL_PROJECT) {
        throw new Error(
          "Refusing to deploy Forma into the dyad Vercel project",
        );
      }
      console.log(`vercel_project=existing name=${project?.name || "unknown"}`);
      return project;
    } catch (error) {
      if (String(error?.message || "").includes("Refusing to deploy")) {
        throw error;
      }
      console.log(
        `vercel_project=existing_unreadable ${redact(error.message)}`,
      );
    }
  }
  let teamRows = [];
  try {
    const teams = await vercelApi(token, "GET", "/v2/teams");
    teamRows = teams.teams || [];
  } catch (error) {
    console.log(`vercel_teams=${redact(error.message)}`);
  }
  const scopes = [
    { id: "", slug: "personal" },
    ...teamRows.map((team) => ({ id: team.id, slug: team.slug })),
  ];
  const visible = [];
  for (const scope of scopes) {
    let projects = [];
    try {
      projects = await projectList(token, scope.id);
    } catch {
      console.log(`vercel_scope=${scope.slug} list=failed`);
      continue;
    }
    const names = projects.map((item) => item.name).join(",") || "none";
    console.log(`vercel_scope=${scope.slug} projects=${names}`);
    visible.push(...projects);
  }
  const selected = selectVercelProject(visible, existing.projectId);
  if (selected) {
    console.log(`vercel_project=selected name=${selected.name}`);
    return selected;
  }
  const names =
    [...new Set(visible.map((item) => item.name))].join(",") || "none";
  throw new Error(
    `Vercel token cannot see the Forma project (visible=${names})`,
  );
}

function teamIdFromProject(project) {
  const teamId = String(project?.accountId || "");
  return teamId.startsWith("team_") ? teamId : "";
}

function teamQuery(project) {
  const teamId = teamIdFromProject(project);
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function deploymentFiles(root) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const relative = full.slice(root.length + 1).replaceAll("\\", "/");
      if (!includeDeploymentFile(relative)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push({ full, relative });
    }
  }
  await walk(root);
  return files;
}

async function uploadDeploymentFile(token, project, bytes) {
  const sha = createHash("sha1").update(bytes).digest("hex");
  const response = await fetch(
    `https://api.vercel.com/v2/files${teamQuery(project)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "x-vercel-digest": sha,
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST /v2/files ${response.status} ${redact(text)}`);
  }
  return { sha, size: bytes.length };
}

async function upsertPreviewEnv(token, project, values) {
  for (const key of [
    "DATABASE_URL",
    "APP_PASSWORD",
    "AUTH_SECRET",
    "CRON_SECRET",
  ]) {
    if (!values[key]) throw new Error(`Refusing an empty ${key}`);
  }
  const query = teamQuery(project);
  const listed = await vercelApi(
    token,
    "GET",
    `/v9/projects/${encodeURIComponent(project.id)}/env${query}`,
  );
  const envs = listed.envs || [];
  for (const [key, value] of Object.entries(values)) {
    if (!value || key.startsWith("VERCEL_")) continue;
    const payload = previewVariablePayload(key, value);
    const existing = envs.find(
      (item) =>
        item.key === key &&
        Array.isArray(item.target) &&
        item.target.length === 1 &&
        item.target[0] === "preview" &&
        !item.gitBranch,
    );
    if (existing?.id) {
      await vercelApi(
        token,
        "PATCH",
        `/v9/projects/${encodeURIComponent(project.id)}/env/${encodeURIComponent(existing.id)}${query}`,
        { value: payload.value, type: "encrypted", target: ["preview"] },
      );
      console.log(`forma_env=updated ${key}`);
      continue;
    }
    await vercelApi(
      token,
      "POST",
      `/v10/projects/${encodeURIComponent(project.id)}/env${query}`,
      payload,
    );
    console.log(`forma_env=created ${key}`);
  }
}

async function deletePreviewAppUrl(token, project) {
  const query = teamQuery(project);
  const listed = await vercelApi(
    token,
    "GET",
    `/v9/projects/${encodeURIComponent(project.id)}/env${query}`,
  );
  const matches = (listed.envs || []).filter((item) => item.key === "APP_URL");
  for (const item of matches) {
    const targets = item.target || [];
    if (targets.includes("production")) {
      console.log("forma_env=kept APP_URL production");
      continue;
    }
    if (!(targets.length === 1 && targets[0] === "preview")) continue;
    await vercelApi(
      token,
      "DELETE",
      `/v9/projects/${encodeURIComponent(project.id)}/env/${encodeURIComponent(item.id)}${query}`,
    );
    console.log("forma_env=deleted APP_URL");
  }
}

async function logDeploymentError(token, project, id) {
  try {
    const events = await vercelApi(
      token,
      "GET",
      `/v3/deployments/${encodeURIComponent(id)}/events${teamQuery(project)}`,
    );
    const lines = (Array.isArray(events) ? events : [])
      .map((item) => item?.text || item?.payload?.text || "")
      .filter(Boolean)
      .slice(-12);
    console.log(`forma_deploy_error=${redact(lines.join(" | "))}`);
  } catch (error) {
    console.log(`forma_deploy_error=unavailable ${redact(error.message)}`);
  }
}

async function waitForDeployment(token, project, deployment) {
  const id = deployment.id;
  if (!id) throw new Error("Vercel did not return a deployment id");
  let host = deployment.url || "";
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const current = await vercelApi(
      token,
      "GET",
      `/v13/deployments/${encodeURIComponent(id)}${teamQuery(project)}`,
    );
    host = current.url || host;
    const state = current.readyState || "";
    if (attempt % 6 === 0) console.log(`forma_deploy=${state || "unknown"}`);
    if (state === "READY") return host;
    if (state === "ERROR" || state === "CANCELED") {
      await logDeploymentError(token, project, id);
      throw new Error(`Vercel deployment ${state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error("Vercel deployment did not become ready");
}

async function disableVercelAuthentication(token, project) {
  const query = teamQuery(project);
  const current = await vercelApi(
    token,
    "GET",
    `/v9/projects/${encodeURIComponent(project.id)}${query}`,
  );
  const deploymentType = current?.ssoProtection?.deploymentType || "absent";
  console.log(`forma_sso=${deploymentType}`);
  if (!current?.ssoProtection) return;
  await vercelApi(
    token,
    "PATCH",
    `/v9/projects/${encodeURIComponent(project.id)}${query}`,
    { ssoProtection: null },
  );
  console.log("forma_sso=disabled");
}

async function deploy(checkout, env, project) {
  const token = env.runtime.VERCEL_TOKEN;
  try {
    await disableVercelAuthentication(token, project);
  } catch (error) {
    console.log(`forma_sso=unchanged ${redact(error.message)}`);
  }
  const values = {
    ...env.runtime,
    DATABASE_URL: env.build.DATABASE_URL,
  };
  delete values.APP_URL;
  await deletePreviewAppUrl(token, project);
  await upsertPreviewEnv(token, project, values);
  const paths = await deploymentFiles(checkout);
  console.log(`forma_upload_files=${paths.length}`);
  const uploaded = [];
  for (let index = 0; index < paths.length; index += 8) {
    const batch = paths.slice(index, index + 8);
    const done = await Promise.all(
      batch.map(async (item) => {
        const bytes = await readFile(item.full);
        const file = await uploadDeploymentFile(token, project, bytes);
        return { file: item.relative, sha: file.sha, size: file.size };
      }),
    );
    uploaded.push(...done);
  }
  const params = new URLSearchParams({
    forceNew: "1",
    skipAutoDetectionConfirmation: "1",
  });
  const teamId = teamIdFromProject(project);
  if (teamId) params.set("teamId", teamId);
  const created = await vercelApi(
    token,
    "POST",
    `/v13/deployments?${params}`,
    sourceDeploymentBody(project, uploaded),
  );
  console.log("forma_deploy=created");
  const host = await waitForDeployment(token, project, created);
  if (!host) throw new Error("Vercel did not return a preview URL");
  return host.startsWith("https://") ? host : `https://${host}`;
}

function noteGithubDeployments() {
  try {
    const deployments = JSON.parse(
      gh(["api", `repos/${FORMA_REPOSITORY}/deployments?per_page=10`]),
    );
    const deploymentUrls = (Array.isArray(deployments) ? deployments : [])
      .map((item) => item?.payload?.web_url || item?.environment || "")
      .filter(Boolean);
    console.log(
      `forma_github_deployments=${deploymentUrls.join(",") || "none"}`,
    );
  } catch (error) {
    console.log(
      `forma_github_deployments=unavailable ${redact(error.message)}`,
    );
  }
}

function notePullRequestLinks(pr) {
  try {
    const comments = JSON.parse(
      gh([
        "api",
        `repos/${FORMA_REPOSITORY}/issues/${pr}/comments?per_page=20`,
      ]),
    );
    const urls = new Set();
    for (const item of Array.isArray(comments) ? comments : []) {
      const found = String(item?.body || "").match(
        /https:\/\/[a-z0-9.-]+\.vercel\.app[^\s)]*/gi,
      );
      for (const url of found || []) urls.add(url.replace(/[.,>]+$/, ""));
    }
    console.log(`forma_pr_vercel_urls=${[...urls].join(",") || "none"}`);
  } catch (error) {
    console.log(`forma_pr_vercel_urls=unavailable ${redact(error.message)}`);
  }
}

function assertNonProductionSource(project, config) {
  if (/prd|prod/i.test(`${project} ${config}`)) {
    throw new Error("Refusing a production Doppler config");
  }
}

async function dopplerSecret(token, project, config, name) {
  assertNonProductionSource(project, config);
  try {
    const payload = await doppler(
      token,
      "GET",
      `/v3/configs/config/secret?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}&name=${encodeURIComponent(name)}`,
    );
    const value = String(payload?.value?.computed ?? payload?.value?.raw ?? "");
    mask(value);
    return value.trim();
  } catch (error) {
    const missing = /404/.test(String(error?.message || ""));
    if (!missing) {
      console.log(
        `forma_vercel_probe=${project}/${config} ${name}=failed ${redact(error.message)}`,
      );
    }
    return "";
  }
}

async function probeVercelSource(adminToken, project, config) {
  assertNonProductionSource(project, config);
  const token = await dopplerSecret(
    adminToken,
    project,
    config,
    "VERCEL_TOKEN",
  );
  if (!token) {
    console.log(`forma_vercel_probe=${project}/${config} token=absent`);
    return null;
  }
  const projectId = await dopplerSecret(
    adminToken,
    project,
    config,
    "VERCEL_PROJECT_ID",
  );
  const orgId = await dopplerSecret(
    adminToken,
    project,
    config,
    "VERCEL_ORG_ID",
  );
  try {
    const selected = await ensureVercelProject(token, { projectId, orgId });
    console.log(
      `forma_vercel_probe=${project}/${config} selected=${selected.name}`,
    );
    return { token, project: selected, source: `${project}/${config}` };
  } catch (error) {
    console.log(
      `forma_vercel_probe=${project}/${config} ${redact(error.message)}`,
    );
    return null;
  }
}

async function resolveVercelProject(adminToken, secrets) {
  try {
    const project = await ensureVercelProject(secrets.VERCEL_TOKEN, {
      projectId: secrets.VERCEL_PROJECT_ID,
      orgId: secrets.VERCEL_ORG_ID,
    });
    return { token: secrets.VERCEL_TOKEN, project, source: "forma/dev" };
  } catch (error) {
    console.log(`forma_vercel_forma_dev=${redact(error.message)}`);
  }
  for (const [project, config] of VERCEL_TOKEN_SOURCES) {
    const found = await probeVercelSource(adminToken, project, config);
    if (found) return found;
  }
  throw new Error(
    "No non-production Doppler config has a Vercel token that can see the Forma project",
  );
}

async function noteFormaImage(sha) {
  const tag = formaImageTag(sha);
  let response = null;
  try {
    response = await fetch(
      `https://ghcr.io/v2/awannaphasch2016/forma/manifests/sha-${sha}`,
      {
        headers: {
          Accept:
            "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
          ...(process.env.GH_TOKEN
            ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
            : {}),
        },
      },
    );
  } catch {
    response = null;
  }
  if (!response || response.status === 401 || response.status === 403) {
    console.log(`forma_image=unavailable ${tag}`);
    return;
  }
  const digest = response.headers.get("docker-content-digest") || "";
  if (response.ok && /^sha256:[0-9a-f]{64}$/.test(digest)) {
    console.log(`forma_image=ghcr.io/awannaphasch2016/forma@${digest}`);
    return;
  }
  console.log(`forma_image=pending ${tag}`);
}

function comment(pr, url, sha) {
  gh([
    "pr",
    "comment",
    pr,
    "--repo",
    FORMA_REPOSITORY,
    "--body",
    formaPreviewComment(url, sha),
  ]);
}

function pullRequestHeadSha(pr) {
  const pull = JSON.parse(gh(["api", `repos/${FORMA_REPOSITORY}/pulls/${pr}`]));
  const sha = requestedFormaSha(pull.head?.sha || "");
  if (!sha) {
    throw new Error("Forma pull request head SHA must be 40 hex characters");
  }
  return sha;
}

function openPullRequestNumberForSha(sha) {
  const listed = JSON.parse(
    gh(["api", `repos/${FORMA_REPOSITORY}/pulls?state=open&per_page=30`]),
  );
  const matches = (Array.isArray(listed) ? listed : []).filter(
    (pull) => String(pull.head?.sha || "") === sha,
  );
  if (matches.length !== 1) return "";
  return String(matches[0].number);
}

function resolveRequestedPreview() {
  const requestedSha = requestedFormaSha(process.env.FORMA_SHA);
  const requestedPr = String(process.env.FORMA_PR ?? "").trim();
  const headSha = requestedPr ? pullRequestHeadSha(requestedPr) : "";
  const target = resolveFormaPreviewTarget({
    sha: requestedSha,
    pr: requestedPr,
    headSha,
  });
  if (target.pr) return target;
  const found = openPullRequestNumberForSha(target.sha);
  if (!found) {
    throw new Error("Pull request number is required for the Neon branch");
  }
  return { pr: found, sha: target.sha, comment: false };
}

export async function runFormaPreview() {
  const environment = assertPreviewEnvironment(
    process.env.FORMA_ENVIRONMENT ?? "",
  );
  console.log(`forma_environment=${environment}`);
  const target = resolveRequestedPreview();
  console.log(`forma_pr=${target.pr}`);
  console.log(`forma_requested_sha=${target.sha}`);
  process.env.FORMA_SHA = target.sha;
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    console.log("DOPPLER_ADMIN_TOKEN=absent");
    process.exitCode = 1;
    return;
  }
  const secrets = await ensureSecrets(token);
  mask(secrets.NEON_API_KEY);
  mask(secrets.VERCEL_TOKEN);
  if (!secrets.NEON_API_KEY || !secrets.VERCEL_TOKEN) {
    console.log("forma_credentials=absent");
    process.exitCode = 1;
    return;
  }
  const vercelNames = Object.keys(secrets)
    .filter((name) => name.startsWith("VERCEL_"))
    .sort();
  console.log(`forma_dev_vercel_names=${vercelNames.join(",") || "none"}`);
  noteGithubDeployments();
  const vercel = await resolveVercelProject(token, secrets);
  console.log(`forma_vercel_source=${vercel.source}`);
  const pr = target.pr;
  notePullRequestLinks(pr);
  const branch = await ensureNeonBranch(secrets.NEON_API_KEY, pr);
  const prepared = await migrate(branch.direct);
  const env = previewEnv({
    pooledUrl: branch.pooled,
    directUrl: branch.direct,
    secrets,
  });
  env.runtime.VERCEL_TOKEN = vercel.token;
  env.runtime.VERCEL_PROJECT_ID = vercel.project.id;
  env.runtime.VERCEL_ORG_ID = vercel.project.accountId;
  const url = await deploy(prepared.checkout, env, vercel.project);
  await probeSignIn(url);
  await probeStatus(url);
  await noteFormaImage(prepared.sha);
  console.log(`forma_url=${url}`);
  if (target.comment) comment(pr, url, prepared.sha);
  else console.log("forma_comment=skipped");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runFormaPreview().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
