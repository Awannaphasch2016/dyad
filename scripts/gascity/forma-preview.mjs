// Create one Forma Vercel preview and one Neon branch for one pull request.
// Prints names, hosts, and the preview URL. Does not print secret values.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

export function previewEnv({ pooledUrl, directUrl, appUrl, secrets }) {
  assertSafeUrl(pooledUrl, true);
  assertSafeUrl(directUrl, false);
  const shared = {
    APP_URL: appUrl,
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
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .slice(0, 900);
}

function mask(value) {
  const text = String(value ?? "").trim();
  if (text) console.log(`::add-mask::${text}`);
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

function openPull(head) {
  const listed = JSON.parse(
    gh([
      "api",
      `repos/${FORMA_REPOSITORY}/pulls?head=Awannaphasch2016:${encodeURIComponent(head)}&state=open`,
    ]),
  );
  const found = listed.find((pull) => pull.head?.ref === head);
  if (found?.number) return String(found.number);
  const pull = JSON.parse(
    gh(
      [
        "api",
        "--method",
        "POST",
        `repos/${FORMA_REPOSITORY}/pulls`,
        "--input",
        "-",
      ],
      JSON.stringify({
        title: "Preview Forma",
        head,
        base: "main",
        body: "Preview this Forma commit on its own Neon branch.",
      }),
    ),
  );
  return String(pull.number);
}

function ensureWalkthroughPullRequest() {
  const ref = spawnSync(
    "gh",
    ["api", `repos/${FORMA_REPOSITORY}/git/ref/heads/${WALKTHROUGH_BRANCH}`],
    { encoding: "utf8", env: process.env },
  );
  if (ref.status === 0) return openPull(WALKTHROUGH_BRANCH);
  const main = JSON.parse(
    gh(["api", `repos/${FORMA_REPOSITORY}/git/ref/heads/main`]),
  );
  main.sha = main.object.sha;
  const note =
    "This pull request is the Forma preview walkthrough.\nThe site is the Vercel preview commented below.\n";
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
      JSON.stringify({ content: note, encoding: "utf-8" }),
    ),
  );
  const tree = JSON.parse(
    gh(
      [
        "api",
        "--method",
        "POST",
        `repos/${FORMA_REPOSITORY}/git/trees`,
        "--input",
        "-",
      ],
      JSON.stringify({
        base_tree: main.sha,
        tree: [
          {
            path: "docs/preview-walkthrough.md",
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          },
        ],
      }),
    ),
  );
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
        message: "Add the Forma preview walkthrough note.",
        tree: tree.sha,
        parents: [main.sha],
      }),
    ),
  );
  gh(
    [
      "api",
      "--method",
      "POST",
      `repos/${FORMA_REPOSITORY}/git/refs`,
      "--input",
      "-",
    ],
    JSON.stringify({
      ref: `refs/heads/${WALKTHROUGH_BRANCH}`,
      sha: commit.sha,
    }),
  );
  return openPull(WALKTHROUGH_BRANCH);
}

async function migrate(directUrl) {
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
  run("corepack", ["enable"], { cwd: checkout });
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: checkout });
  const envFile = join(checkout, ".env.local");
  await writeFile(envFile, `DATABASE_URL=${directUrl}\n`);
  const output = run("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
    cwd: checkout,
    env: { DATABASE_URL: directUrl },
  });
  if (!output.includes("Database schema ready.")) {
    throw new Error("Database schema was not ready");
  }
  console.log("forma_migrate=ready");
  return checkout;
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

async function ensureVercelProject(token) {
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
    const existing = projects.find((item) => item.name === "forma");
    if (existing) return existing;
  }
  for (const scope of scopes) {
    if (!scope.id) continue;
    try {
      const created = await vercelApi(
        token,
        "POST",
        `/v10/projects?teamId=${encodeURIComponent(scope.id)}`,
        { name: "forma", framework: "nextjs" },
      );
      console.log(`vercel_project=created scope=${scope.slug}`);
      return created;
    } catch (error) {
      console.log(
        `vercel_project=refused scope=${scope.slug} ${redact(error.message)}`,
      );
    }
  }
  throw new Error("Vercel token cannot create the forma project");
}

async function deploy(checkout, env) {
  const token = env.runtime.VERCEL_TOKEN;
  const project = await ensureVercelProject(token);
  await mkdir(join(checkout, ".vercel"), { recursive: true });
  await writeFile(
    join(checkout, ".vercel", "project.json"),
    `${JSON.stringify({ orgId: project.accountId, projectId: project.id })}\n`,
  );
  const args = ["deploy", "--yes", "--token", token];
  for (const [key, value] of Object.entries(env.runtime)) {
    if (!value || key === "VERCEL_TOKEN") continue;
    args.push("--env", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(env.build)) {
    if (!value) continue;
    args.push("--build-env", `${key}=${value}`);
  }
  const output = run("vercel", args, {
    cwd: checkout,
    env: {
      CI: "1",
      VERCEL_ORG_ID: project.accountId,
      VERCEL_PROJECT_ID: project.id,
    },
  });
  const url = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^https:\/\/[a-z0-9.-]+\.vercel\.app/.test(line));
  if (!url)
    throw new Error(`Vercel did not return a preview URL ${redact(output)}`);
  return url.split(" ")[0];
}

function comment(pr, url) {
  gh([
    "pr",
    "comment",
    pr,
    "--repo",
    FORMA_REPOSITORY,
    "--body",
    `Forma preview: ${url}\n\nSign in with APP_PASSWORD from Doppler project forma, config dev.`,
  ]);
}

export async function runFormaPreview() {
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
  const pr = process.env.FORMA_PR || ensureWalkthroughPullRequest();
  console.log(`forma_pr=${pr}`);
  const branch = await ensureNeonBranch(secrets.NEON_API_KEY, pr);
  const checkout = await migrate(branch.direct);
  const env = previewEnv({
    pooledUrl: branch.pooled,
    directUrl: branch.direct,
    appUrl: "https://forma-preview.vercel.app",
    secrets,
  });
  env.runtime.VERCEL_TOKEN = secrets.VERCEL_TOKEN;
  const url = await deploy(checkout, env);
  console.log(`forma_url=${url}`);
  comment(pr, url);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runFormaPreview().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
