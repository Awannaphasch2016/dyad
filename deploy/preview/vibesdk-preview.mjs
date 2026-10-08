// Decide, deploy, and delete one Vibe SDK preview. Dyad's controller is not used.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { commandForPullRequest } from "./transition.mjs";
import {
  deletePreviewResources,
  ensurePreviewResources,
  previewWasDeleted,
} from "./vibesdk-cloudflare.mjs";
import {
  PREVIEW_COMMENT_MARKER,
  THINK_MODEL_ID,
  VIBESDK_PREVIEW_LABEL,
  VIBESDK_SHA,
  assertAccountId,
  patchAppCreationLimit,
  patchPreviewPane,
  patchPreviewServing,
  patchStaticSiteDeploy,
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
  previewCommentBody,
  previewConfigViolations,
  previewNames,
  previewWranglerConfig,
  secretReady,
} from "./vibesdk.mjs";

const configName = "wrangler.jsonc";

export function eventFromEnv(env) {
  return {
    action: env.ACTION || "",
    label: env.LABEL || "",
    labels: String(env.LABELS || "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    closed: env.CLOSED === "true",
  };
}

export function decideFromEvent(event) {
  return commandForPullRequest(event, VIBESDK_PREVIEW_LABEL);
}

export function commandFromEnv(env = process.env) {
  if (env.EVENT_NAME === "workflow_dispatch") {
    previewNames(String(env.PR ?? "").trim());
    return "destroy";
  }
  return decideFromEvent(eventFromEnv(env));
}

export function removalCommentAction({ deleted, existingBody }) {
  if (deleted) return "removed";
  if (
    typeof existingBody === "string" &&
    existingBody.includes("cleanup did not finish")
  ) {
    return "removed";
  }
  return "silent";
}

export function cloudflareCreds(env, { openRouter = false } = {}) {
  const token = String(env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (!secretReady(token)) {
    throw new Error("CLOUDFLARE_API_TOKEN is not available");
  }
  assertAccountId(accountId);
  const openRouterKey = String(env.OPENROUTER_API_KEY ?? "").trim();
  if (openRouter && !secretReady(openRouterKey)) {
    throw new Error("OPENROUTER_API_KEY is not available");
  }
  return {
    token,
    accountId,
    openRouterKey,
    anthropicKey: String(env.ANTHROPIC_API_KEY ?? "").trim(),
  };
}

export function cloudflareClient(token, fetchImpl = fetch) {
  return async (method, path, body) => {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }
    return { status: response.status, payload };
  };
}

function toolEnv(creds, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    CI: "true",
    HUSKY: "0",
    CLOUDFLARE_API_TOKEN: creds.token,
    CLOUDFLARE_ACCOUNT_ID: creds.accountId,
    ...extra,
  };
}

function mask(value) {
  const text = String(value ?? "").trim();
  if (!text || /[\r\n]/.test(text) || text.length < 20) return;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${text}`);
  }
}

function failureTail(output) {
  const text = String(output)
    .replace(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      "[redacted-pem]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines.filter((line) =>
    /error|invalid|denied|required|not found|✘|failed|paid/i.test(line),
  );
  const picked = [];
  const seen = new Set();
  for (const line of [...interesting.slice(-12), ...lines.slice(-6)]) {
    if (seen.has(line)) continue;
    seen.add(line);
    picked.push(line);
  }
  return picked.join("\n").slice(-1200);
}

export function spawnCommand(command, args, { cwd, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.end(input ?? "");
    child.on("close", (code) => {
      const output = `${stdout}\n${stderr}`;
      if (code !== 0) {
        reject(new Error(`${command} ${code}\n${failureTail(output)}`));
        return;
      }
      resolve(output);
    });
  });
}

export async function waitForHealth(
  url,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 5,
) {
  if (
    !/^https:\/\/vibesdk-pr-[0-9]+\.karant-test-egress-canary\.workers\.dev$/.test(
      url,
    )
  ) {
    throw new Error("refusing health url");
  }
  let status = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(`${url}/api/health`);
    status = response.status;
    if (status === 200) return status;
    if (attempt + 1 < attempts) await sleep(3000);
  }
  throw new Error(`health ${status}`);
}

async function putSecret(run, cwd, name, value, env) {
  mask(value);
  await run(
    join(cwd, "node_modules/.bin/wrangler"),
    ["secret", "put", name, "--config", configName],
    { cwd, input: `${value}\n`, env },
  );
  console.log(`secret=${name} stored`);
}

export async function provisionPreview(options) {
  const creds = cloudflareCreds(options.env ?? process.env, {
    openRouter: true,
  });
  mask(creds.token);
  mask(creds.openRouterKey);
  const request =
    options.request ?? cloudflareClient(creds.token, options.fetchImpl);
  const ensured = await ensurePreviewResources({
    request,
    accountId: creds.accountId,
    pr: options.pr,
  });
  const config = previewWranglerConfig({
    accountId: creds.accountId,
    databaseId: ensured.databaseId,
    kvId: ensured.kvId,
    names: ensured.names,
  });
  const violations = previewConfigViolations(config, ensured.names);
  if (violations.length > 0) {
    throw new Error(`preview config refused ${violations.join(",")}`);
  }
  const run = options.run ?? spawnCommand;
  const names = ensured.names;
  let checkout = "";
  try {
    checkout = await mkdtemp(join(tmpdir(), `vibesdk-pr-${names.pr}-`));
    await run("git", ["init", checkout], { env: toolEnv(creds) });
    await run(
      "git",
      [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/cloudflare/vibesdk.git",
      ],
      { env: toolEnv(creds) },
    );
    await run(
      "git",
      ["-C", checkout, "fetch", "--depth", "1", "origin", VIBESDK_SHA],
      { env: toolEnv(creds) },
    );
    await run("git", ["-C", checkout, "checkout", "--detach", "FETCH_HEAD"], {
      env: toolEnv(creds),
    });
    console.log(`checkout=${VIBESDK_SHA}`);
    const modelPath = join(checkout, "worker/agents/think/model-config.ts");
    const routingPath = join(checkout, "worker/agents/core/behaviors/think.ts");
    const entryPath = join(checkout, "worker/index.ts");
    await writeFile(
      modelPath,
      patchThinkModel(await readFile(modelPath, "utf8")),
    );
    await writeFile(
      routingPath,
      patchThinkRouting(await readFile(routingPath, "utf8")),
    );
    await writeFile(
      entryPath,
      patchWorkerExports(await readFile(entryPath, "utf8")),
    );
    const limitsPath = join(checkout, "worker/services/rate-limit/config.ts");
    await writeFile(
      limitsPath,
      patchAppCreationLimit(await readFile(limitsPath, "utf8")),
    );
    console.log("app_creation_limit=disabled");
    const deployEnginePath = join(checkout, "space/src/space/deploy-engine.ts");
    const spaceObjectPath = join(checkout, "space/src/space/durable-object.ts");
    const previewPanePath = join(
      checkout,
      "src/routes/chat/components/preview-iframe.tsx",
    );
    await writeFile(
      deployEnginePath,
      patchStaticSiteDeploy(await readFile(deployEnginePath, "utf8")),
    );
    await writeFile(
      spaceObjectPath,
      patchPreviewServing(await readFile(spaceObjectPath, "utf8")),
    );
    await writeFile(
      previewPanePath,
      patchPreviewPane(await readFile(previewPanePath, "utf8")),
    );
    console.log("static_preview=enabled");
    console.log(`think_provider=openrouter think_model=${THINK_MODEL_ID}`);
    await writeFile(
      join(checkout, configName),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    const cloudflareEnv = toolEnv(creds);
    await run("bun", ["install", "--frozen-lockfile"], {
      cwd: checkout,
      env: cloudflareEnv,
    });
    await run("bun", ["run", "build"], {
      cwd: checkout,
      env: toolEnv(creds, { NODE_OPTIONS: "--max-old-space-size=4096" }),
    });
    const deployLog = await run(
      join(checkout, "node_modules/.bin/wrangler"),
      ["deploy", "--config", configName],
      { cwd: checkout, env: cloudflareEnv },
    );
    if (!deployLog.includes(names.url)) {
      throw new Error(
        `workers.dev url was not in the deploy output\n${failureTail(deployLog)}`,
      );
    }
    const jwtSecret = randomBytes(36).toString("base64url");
    await putSecret(run, checkout, "JWT_SECRET", jwtSecret, cloudflareEnv);
    await putSecret(
      run,
      checkout,
      "OPENROUTER_API_KEY",
      creds.openRouterKey,
      cloudflareEnv,
    );
    await putSecret(
      run,
      checkout,
      "CLOUDFLARE_API_TOKEN",
      creds.token,
      cloudflareEnv,
    );
    if (secretReady(creds.anthropicKey)) {
      await putSecret(
        run,
        checkout,
        "ANTHROPIC_API_KEY",
        creds.anthropicKey,
        cloudflareEnv,
      );
    }
    if (names.d1 !== previewNames(names.pr).d1) {
      throw new Error("refusing migration target");
    }
    await run(
      join(checkout, "node_modules/.bin/wrangler"),
      [
        "d1",
        "migrations",
        "apply",
        names.d1,
        "--remote",
        "--config",
        configName,
      ],
      { cwd: checkout, env: cloudflareEnv },
    );
    console.log("migrations=applied");
    await waitForHealth(names.url, options.fetchImpl ?? fetch, options.sleep);
    return ensured;
  } finally {
    if (checkout) await rm(checkout, { recursive: true, force: true });
  }
}

export async function deleteFromEnv(pr, options = {}) {
  const creds = cloudflareCreds(options.env ?? process.env);
  const request =
    options.request ?? cloudflareClient(creds.token, options.fetchImpl);
  return deletePreviewResources({
    request,
    accountId: creds.accountId,
    pr,
  });
}

export async function upsertPreviewComment({
  repo,
  pr,
  token,
  body,
  fetchImpl = fetch,
  readOnly = false,
}) {
  const githubToken = String(token ?? "").trim();
  if (!githubToken || /[\r\n]/.test(githubToken)) {
    throw new Error("GITHUB_TOKEN is not available");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo ?? ""))) {
    throw new Error("repository is required");
  }
  if (!/^[0-9]+$/.test(String(pr))) {
    throw new Error("Pull request number is required");
  }
  const [owner, name] = String(repo).split("/");
  const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    "User-Agent": "dyad-vibesdk-preview",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const github = async (url, options) => {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }
    return { status: response.status, payload };
  };
  const listed = await github(`${root}/issues/${pr}/comments?per_page=100`, {
    headers,
  });
  if (listed.status !== 200) throw new Error(`comment list ${listed.status}`);
  const comments = Array.isArray(listed.payload) ? listed.payload : [];
  const existing = comments.find(
    (comment) =>
      typeof comment?.body === "string" &&
      comment.body.includes(PREVIEW_COMMENT_MARKER),
  );
  if (readOnly) {
    return { updated: Boolean(existing), body: existing?.body ?? "" };
  }
  const saved = existing
    ? await github(`${root}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body }),
      })
    : await github(`${root}/issues/${pr}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });
  if (saved.status !== 200 && saved.status !== 201) {
    throw new Error(`comment write ${saved.status}`);
  }
  return { updated: Boolean(existing) };
}

export async function announceRemoval({
  repo,
  pr,
  token,
  deleted,
  fetchImpl = fetch,
}) {
  const names = previewNames(pr);
  let existingBody = "";
  if (!deleted) {
    const listed = await upsertPreviewComment({
      repo,
      pr,
      token,
      body: null,
      fetchImpl,
      readOnly: true,
    });
    existingBody = listed.body ?? "";
  }
  if (removalCommentAction({ deleted, existingBody }) !== "removed") {
    return "silent";
  }
  await upsertPreviewComment({
    repo,
    pr,
    token,
    body: previewCommentBody("removed", names),
    fetchImpl,
  });
  return "removed";
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function main() {
  const command = process.argv[2];
  if (command === "decide") {
    const result = commandFromEnv(process.env);
    console.log(result);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `command=${result}\n`);
    }
    return;
  }
  const pr = arg("--pr");
  if (command === "comment") {
    const kind = arg("--kind");
    if (kind === "removed") {
      const posted = await announceRemoval({
        repo: process.env.GITHUB_REPOSITORY,
        pr,
        token: process.env.GITHUB_TOKEN,
        deleted: process.env.DELETED === "true",
      });
      console.log(`comment=${posted}`);
      return;
    }
    const names = kind === "failed" ? undefined : previewNames(pr);
    await upsertPreviewComment({
      repo: process.env.GITHUB_REPOSITORY,
      pr,
      token: process.env.GITHUB_TOKEN,
      body: previewCommentBody(kind, names),
    });
    console.log(`comment=${kind}`);
    return;
  }
  if (command === "up") {
    const ready = await provisionPreview({ pr });
    console.log(`preview_url=${ready.names.url}`);
    return;
  }
  if (command === "down") {
    const removed = await deleteFromEnv(pr);
    const deleted = previewWasDeleted(removed);
    console.log(`preview_deleted=${removed.names.url}`);
    console.log(`worker=${removed.worker.deleted ? "deleted" : "absent"}`);
    console.log(`d1=${removed.d1.deleted ? "deleted" : "absent"}`);
    console.log(`kv=${removed.kv.deleted ? "deleted" : "absent"}`);
    console.log(`r2=${removed.r2.deleted ? "deleted" : "absent"}`);
    console.log(`deleted=${deleted}`);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `deleted=${deleted ? "true" : "false"}\n`,
      );
    }
    return;
  }
  console.error("Usage: vibesdk-preview.mjs <decide|up|down|comment>");
  process.exit(2);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exit(1);
  });
}
