// Deploy the isolated vibeSDK lab. Secret values are masked and never printed.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { redact, VIBESDK_PROJECT_NAME } from "./vibesdk-project.mjs";
import {
  errorSummary,
  referenceResolved,
  sourceConfigOrder,
  storedSecretKind,
} from "./vibesdk-references.mjs";
import {
  LAB_CONFIG_NAME,
  LAB_D1_NAME,
  LAB_GATEWAY_ID,
  LAB_KV_TITLE,
  LAB_PROMPT,
  LAB_R2_NAME,
  LAB_THINK_MODEL_ID,
  LAB_THINK_PROVIDER,
  optionalLabSecrets,
  requiredLabSecrets,
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
  shouldMask,
  takeOpenRouter,
  failureTail,
  labWebsocketUrl,
  modelTurnOutcome,
  parseWorkersDevUrl,
  patchAppCreationLimit,
  patchThinkModel,
  patchThinkRouting,
  patchWorkerExports,
  promptOutcome,
  providerConfigBody,
  r2CreateBody,
  rowsOf,
  storeCookies,
} from "./vibesdk-lab.mjs";

function mask(value) {
  if (!shouldMask(value)) return;
  console.log(`::add-mask::${value.trim()}`);
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
            `${args[0] ?? command} ${code}\n${redact(failureTail(output))}`,
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
  const streamed = await readPromptStream(prompt, url, jar.accessToken);
  const outcome = promptOutcome(streamed.text);
  console.log(
    `prompt=${prompt.status} agent=${outcome.agent} reply=${outcome.reply} error=${redact(outcome.error) || "none"}`,
  );
  if (prompt.status !== 200 || outcome.agent !== "present") {
    throw new Error(`prompt failed ${prompt.status}`);
  }
  if (outcome.error) {
    throw new Error(`prompt error ${redact(outcome.error)}`);
  }
  const turn = streamed.turn ?? { error: "", reply: "absent" };
  console.log(
    `model_reply=${turn.reply} model_error=${redact(turn.error) || "none"}`,
  );
  if (turn.error) {
    throw new Error(`model error ${redact(turn.error)}`);
  }
  if (turn.reply === "absent") {
    throw new Error("model reply absent");
  }
}

async function readPromptStream(response, pageUrl, accessToken) {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: await response.text(), turn: null };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let websocketUrl = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (websocketUrl) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const candidate = labWebsocketUrl(row, pageUrl);
      if (row?.agentId && candidate) websocketUrl = candidate;
    }
  }
  return {
    text,
    turn: websocketUrl ? await watchModelTurn(websocketUrl, accessToken) : null,
  };
}

function watchModelTurn(websocketUrl, accessToken) {
  return new Promise((resolve) => {
    const messages = [];
    let settled = false;
    let opened = false;
    let socket;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // The socket may already be closed.
      }
      const outcome = modelTurnOutcome(messages);
      if (!opened && !outcome.error) {
        resolve({ error: "websocket unavailable", reply: "absent" });
        return;
      }
      resolve(outcome);
    };
    try {
      socket = new WebSocket(websocketUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Cookie: `accessToken=${encodeURIComponent(accessToken)}`,
        },
      });
    } catch {
      console.log("model_ws=unsupported");
      resolve({ error: "websocket client unavailable", reply: "absent" });
      return;
    }
    timer = setTimeout(finish, 90000);
    socket.addEventListener("open", () => {
      opened = true;
      console.log("model_ws=open");
      socket.send(JSON.stringify({ type: "generate_all" }));
    });
    socket.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      const outcome = modelTurnOutcome(messages);
      if (outcome.error || outcome.reply !== "absent") finish();
    });
    socket.addEventListener("error", () => {
      console.log("model_ws=error");
      if (!opened) finish();
    });
    socket.addEventListener("close", finish);
  });
}

async function openRouterFromDyad(adminToken) {
  for (const config of sourceConfigOrder) {
    let payload;
    try {
      payload = await doppler(
        adminToken,
        `/v3/configs/config/secrets?project=dyad&config=${encodeURIComponent(config)}`,
      );
    } catch (error) {
      console.log(`openrouter_dyad_${config}=skipped ${redact(error.message)}`);
      continue;
    }
    const found = takeOpenRouter(payload);
    for (const name of found.privateKeyNames) {
      console.log(`private_key_name=${name} config=${config}`);
    }
    if (found.key) {
      mask(found.key);
      console.log(`OPENROUTER_API_KEY_source=dyad/${config}`);
      return found.key;
    }
  }
  return "";
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
  const listed = await doppler(
    adminToken,
    `/v3/configs/config/secrets?project=${VIBESDK_PROJECT_NAME}&config=dev`,
  );
  for (const name of [...requiredLabSecrets, ...optionalLabSecrets]) {
    const entry = listed.secrets?.[name];
    console.log(`${name}_stored=${storedSecretKind(entry?.raw)}`);
    if (entry && typeof entry === "object") {
      entry.raw = undefined;
      entry.computed = undefined;
    }
  }
  const cloudflareToken = String(downloaded.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = String(downloaded.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const anthropicKey = String(downloaded.ANTHROPIC_API_KEY ?? "").trim();
  let openRouterKey = String(downloaded.OPENROUTER_API_KEY ?? "").trim();
  for (const [name, value] of [
    ["CLOUDFLARE_API_TOKEN", cloudflareToken],
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["ANTHROPIC_API_KEY", anthropicKey],
  ]) {
    console.log(`${name}=${referenceResolved(value)}`);
    if (referenceResolved(value) !== "yes") {
      throw new Error(`${name} is not available`);
    }
  }
  if (referenceResolved(openRouterKey) !== "yes") {
    openRouterKey = await openRouterFromDyad(adminToken);
  }
  console.log(
    `OPENROUTER_API_KEY=${referenceResolved(openRouterKey) === "yes" ? "yes" : "absent"}`,
  );
  if (referenceResolved(openRouterKey) !== "yes") {
    throw new Error("OPENROUTER_API_KEY is not available");
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
  const routingPath = join(checkout, "worker/agents/core/behaviors/think.ts");
  const entryPath = join(checkout, "worker/index.ts");
  const limitsPath = join(checkout, "worker/services/rate-limit/config.ts");
  await writeFile(
    modelPath,
    patchThinkModel(await readFile(modelPath, "utf8")),
  );
  await writeFile(
    routingPath,
    patchThinkRouting(await readFile(routingPath, "utf8")),
  );
  console.log(
    `think_provider=${LAB_THINK_PROVIDER} think_model=${LAB_THINK_MODEL_ID}`,
  );
  await writeFile(
    entryPath,
    patchWorkerExports(await readFile(entryPath, "utf8")),
  );
  await writeFile(
    limitsPath,
    patchAppCreationLimit(await readFile(limitsPath, "utf8")),
  );
  console.log("app_creation_limit=disabled");
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
  let deployLog;
  try {
    deployLog = await run(
      wranglerBin(checkout),
      ["deploy", "--config", LAB_CONFIG_NAME],
      { cwd: checkout, env: cloudflareEnv },
    );
  } catch (error) {
    const message = String(error?.message || "");
    if (
      /10084|enable-durable-objects|agree to pricing|Durable Objects/i.test(
        message,
      )
    ) {
      console.log("durable_objects=pricing_required");
      console.log(
        "durable_objects_url_path=workers/overview?enable-durable-objects",
      );
    }
    throw error;
  }
  const url = parseWorkersDevUrl(deployLog);
  if (!url) {
    throw new Error("workers.dev url was not in the deploy output");
  }
  console.log(`lab_url=${url}`);

  const jwtSecret = randomBytes(36).toString("base64url");
  await putSecret(checkout, "JWT_SECRET", jwtSecret, cloudflareEnv);
  await putSecret(checkout, "ANTHROPIC_API_KEY", anthropicKey, cloudflareEnv);
  if (referenceResolved(openRouterKey) === "yes") {
    await putSecret(
      checkout,
      "OPENROUTER_API_KEY",
      openRouterKey,
      cloudflareEnv,
    );
  } else {
    console.log("secret=OPENROUTER_API_KEY skipped");
  }
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
