// Deploy the isolated vibeSDK lab. Secret values are masked and never printed.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { redact, VIBESDK_PROJECT_NAME } from "./vibesdk-project.mjs";
import { errorSummary, referenceResolved } from "./vibesdk-references.mjs";
import {
  LAB_CONFIG_NAME,
  LAB_D1_NAME,
  LAB_GATEWAY_ID,
  LAB_KV_TITLE,
  LAB_PROMPT,
  LAB_R2_NAME,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
  VIBESDK_SHA,
  csrfTokenFromJar,
  d1CreateBody,
  d1Id,
  findNamed,
  gatewayCreateBody,
  kvCreateBody,
  labConfigViolations,
  labPassword,
  labWranglerConfig,
  parseWorkersDevUrl,
  patchThinkModel,
  patchWorkerExports,
  promptOutcome,
  providerConfigBody,
  r2CreateBody,
  rowsOf,
  storeCookies,
} from "./vibesdk-lab.mjs";

function mask(value) {
  if (typeof value === "string" && value.length > 0) {
    console.log(`::add-mask::${value}`);
  }
}

async function doppler(token, path) {
  const response = await fetch(`https://api.doppler.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
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
      `GET ${path.split("?")[0]} ${response.status} ${redact(payload?.message || text)}`,
    );
  }
  return payload;
}

async function cloudflare(token, method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 180) };
    }
  }
  return { status: response.status, payload };
}

function failureText(path, status, payload) {
  const summary = errorSummary(payload);
  return `${path.split("?")[0]} ${status} code=${redact(summary.code) || "none"} message=${redact(summary.message) || "none"}`;
}

function run(command, args, { cwd, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env, CI: "true" },
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
        reject(
          new Error(
            `${command} ${args[0] ?? ""} ${code} ${redact(output).slice(0, 700)}`,
          ),
        );
        return;
      }
      resolve(output);
    });
  });
}

async function listRows(cf, path) {
  const rows = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await cf(
      "GET",
      `${path}${separator}page=${page}&per_page=100`,
    );
    if (result.status !== 200 || result.payload?.success === false) {
      throw new Error(failureText(path, result.status, result.payload));
    }
    rows.push(...rowsOf(result.payload));
    const info = result.payload?.result_info;
    if (!info?.total_pages || page >= info.total_pages) break;
  }
  return rows;
}

async function ensureResource(cf, { label, path, body, field, expected }) {
  const existing = findNamed(await listRows(cf, path), field, expected);
  if (existing) {
    console.log(`${label}=present`);
    return existing;
  }
  const created = await cf("POST", path, body);
  if (created.status === 200 || created.status === 201) {
    const row = created.payload?.result ?? {};
    console.log(`${label}=created`);
    return row;
  }
  const again = findNamed(await listRows(cf, path), field, expected);
  if (again) {
    console.log(`${label}=present`);
    return again;
  }
  throw new Error(failureText(path, created.status, created.payload));
}

function wranglerBin(cwd) {
  return join(cwd, "node_modules/.bin/wrangler");
}

function setCookieLines(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

async function putSecret(cwd, name, value, cloudflareEnv) {
  mask(value);
  await run(
    wranglerBin(cwd),
    ["secret", "put", name, "--config", LAB_CONFIG_NAME],
    { cwd, input: `${value}\n`, env: cloudflareEnv },
  );
  console.log(`secret=${name} stored`);
}

async function smoke(url, password) {
  const health = await fetch(`${url}/api/health`);
  console.log(`health=${health.status}`);
  if (health.status !== 200) {
    throw new Error(`health ${health.status}`);
  }
  const jar = {};
  const csrf = await fetch(`${url}/api/auth/csrf-token`);
  storeCookies(jar, setCookieLines(csrf));
  const token = csrfTokenFromJar(jar);
  const email = `lab-smoke-${Date.now()}@example.com`;
  const register = await fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `csrf-token=${encodeURIComponent(jar["csrf-token"] || "")}`,
      "X-CSRF-Token": token,
    },
    body: JSON.stringify({
      email,
      password,
      name: "Lab Smoke",
    }),
  });
  const registerText = await register.text();
  storeCookies(jar, setCookieLines(register));
  console.log(
    `register=${register.status} access_cookie=${jar.accessToken ? "present" : "absent"}`,
  );
  if (register.status !== 200) {
    console.log(`register_body=${redact(registerText).slice(0, 240)}`);
  }
  if (register.status !== 200 || !jar.accessToken) {
    throw new Error(`register failed ${register.status}`);
  }
  mask(jar.accessToken);
  const prompt = await fetch(`${url}/api/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jar.accessToken}`,
      Cookie: `accessToken=${encodeURIComponent(jar.accessToken)}`,
    },
    body: JSON.stringify({
      query: LAB_PROMPT,
      behaviorType: "think",
      projectType: "app",
    }),
    signal: AbortSignal.timeout(180000),
  });
  const promptText = await prompt.text();
  const outcome = promptOutcome(promptText);
  console.log(
    `prompt=${prompt.status} agent=${outcome.agent} reply=${outcome.reply} error=${redact(outcome.error) || "none"}`,
  );
  if (prompt.status !== 200 || outcome.agent !== "present") {
    throw new Error(`prompt failed ${prompt.status}`);
  }
  if (outcome.error) {
    throw new Error(`prompt error ${redact(outcome.error)}`);
  }
}

async function main() {
  const adminToken = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!adminToken) {
    console.log("admin_token=absent");
    process.exit(1);
  }
  mask(adminToken);
  const downloaded = await doppler(
    adminToken,
    `/v3/configs/config/secrets/download?project=${VIBESDK_PROJECT_NAME}&config=dev&format=json`,
  );
  for (const value of Object.values(downloaded)) {
    if (typeof value === "string") mask(value);
  }
  const cloudflareToken = String(downloaded.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = String(downloaded.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const anthropicKey = String(downloaded.ANTHROPIC_API_KEY ?? "").trim();
  const openRouterKey = String(downloaded.OPENROUTER_API_KEY ?? "").trim();
  for (const [name, value] of [
    ["CLOUDFLARE_API_TOKEN", cloudflareToken],
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["ANTHROPIC_API_KEY", anthropicKey],
    ["OPENROUTER_API_KEY", openRouterKey],
  ]) {
    console.log(`${name}=${referenceResolved(value)}`);
    if (referenceResolved(value) !== "yes") {
      throw new Error(`${name} is not available`);
    }
  }

  const cf = (method, path, body) =>
    cloudflare(cloudflareToken, method, path, body);
  const account = `/accounts/${encodeURIComponent(accountId)}`;

  const gateway = await ensureResource(cf, {
    label: "gateway",
    path: `${account}/ai-gateway/gateways`,
    body: gatewayCreateBody(),
    field: "id",
    expected: LAB_GATEWAY_ID,
  });
  if ((gateway.id ?? LAB_GATEWAY_ID) !== LAB_GATEWAY_ID) {
    throw new Error("refusing unexpected gateway");
  }
  const byok = await cf(
    "POST",
    `${account}/ai-gateway/gateways/${encodeURIComponent(LAB_GATEWAY_ID)}/provider_configs`,
    providerConfigBody(anthropicKey),
  );
  if (byok.status === 200 || byok.status === 201) {
    console.log("byok=stored");
  } else if (byok.status === 409) {
    console.log("byok=present");
  } else {
    console.log(
      `byok=skipped ${failureText("provider_configs", byok.status, byok.payload)}`,
    );
  }

  const database = await ensureResource(cf, {
    label: "d1",
    path: `${account}/d1/database`,
    body: d1CreateBody(),
    field: "name",
    expected: LAB_D1_NAME,
  });
  const databaseId = d1Id(database);
  if (!databaseId || databaseId === PRODUCTION_DATABASE_ID) {
    throw new Error("refusing production d1");
  }
  console.log(`d1_id=${databaseId}`);

  const kv = await ensureResource(cf, {
    label: "kv",
    path: `${account}/storage/kv/namespaces`,
    body: kvCreateBody(),
    field: "title",
    expected: LAB_KV_TITLE,
  });
  const kvId = String(kv.id ?? "");
  if (!kvId || kvId === PRODUCTION_KV_ID) {
    throw new Error("refusing production kv");
  }
  console.log(`kv_id=${kvId}`);

  await ensureResource(cf, {
    label: "r2",
    path: `${account}/r2/buckets`,
    body: r2CreateBody(),
    field: "name",
    expected: LAB_R2_NAME,
  });

  const checkout = await mkdtemp(join(tmpdir(), "vibesdk-lab-"));
  await run("git", ["init", checkout]);
  await run("git", [
    "-C",
    checkout,
    "remote",
    "add",
    "origin",
    "https://github.com/cloudflare/vibesdk.git",
  ]);
  await run("git", [
    "-C",
    checkout,
    "fetch",
    "--depth",
    "1",
    "origin",
    VIBESDK_SHA,
  ]);
  await run("git", ["-C", checkout, "checkout", "--detach", "FETCH_HEAD"]);
  console.log(`checkout=${VIBESDK_SHA}`);

  const modelPath = join(checkout, "worker/agents/think/model-config.ts");
  const entryPath = join(checkout, "worker/index.ts");
  await writeFile(
    modelPath,
    patchThinkModel(await readFile(modelPath, "utf8")),
  );
  await writeFile(
    entryPath,
    patchWorkerExports(await readFile(entryPath, "utf8")),
  );
  const config = labWranglerConfig({ accountId, databaseId, kvId });
  const violations = labConfigViolations(config);
  if (violations.length > 0) {
    throw new Error(`lab config refused ${violations.join(",")}`);
  }
  await writeFile(
    join(checkout, LAB_CONFIG_NAME),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  await run("bun", ["install", "--frozen-lockfile"], {
    cwd: checkout,
    env: { HUSKY: "0" },
  });
  await run("bun", ["run", "build"], {
    cwd: checkout,
    env: { NODE_OPTIONS: "--max-old-space-size=4096" },
  });
  const cloudflareEnv = {
    CLOUDFLARE_API_TOKEN: cloudflareToken,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
  const deployLog = await run(
    wranglerBin(checkout),
    ["deploy", "--config", LAB_CONFIG_NAME],
    { cwd: checkout, env: cloudflareEnv },
  );
  const url = parseWorkersDevUrl(deployLog);
  if (!url) {
    throw new Error("workers.dev url was not in the deploy output");
  }
  console.log(`lab_url=${url}`);

  const jwtSecret = randomBytes(36).toString("base64url");
  await putSecret(checkout, "JWT_SECRET", jwtSecret, cloudflareEnv);
  await putSecret(checkout, "ANTHROPIC_API_KEY", anthropicKey, cloudflareEnv);
  await putSecret(checkout, "OPENROUTER_API_KEY", openRouterKey, cloudflareEnv);
  await putSecret(
    checkout,
    "CLOUDFLARE_API_TOKEN",
    cloudflareToken,
    cloudflareEnv,
  );

  await run(
    wranglerBin(checkout),
    [
      "d1",
      "migrations",
      "apply",
      LAB_D1_NAME,
      "--remote",
      "--config",
      LAB_CONFIG_NAME,
    ],
    { cwd: checkout, env: cloudflareEnv },
  );
  console.log("migrations=applied");
  const password = labPassword(randomBytes(18).toString("base64url"));
  mask(password);
  await smoke(url, password);
  console.log("lab_prompt=sent");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(redact(error?.message || String(error)));
    process.exit(1);
  });
}
