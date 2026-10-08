#!/usr/bin/env node
// Start or stop one Forma task for one orchestrator pull request.
// Does not print credentials.

import { readFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { assertPreviewHost } from "./host.mjs";
import { readPinnedImages } from "./compose.mjs";
import {
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  assertFormaPreviewTarget,
  formaPreviewBranchName,
} from "./target.mjs";

const region = "ap-southeast-1";
const accountId = "755283537543";
const schemaUrl =
  "https://raw.githubusercontent.com/Awannaphasch2016/forma/80a8e419f6285378b4dfada336ea8213f3089bab/db/schema.sql";

export function redact(text) {
  return String(text ?? "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/\bsk-or-[A-Za-z0-9_-]+/g, "sk-or-redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA_REDACTED")
    .replace(/ASIA[0-9A-Z]{16}/g, "ASIA_REDACTED")
    .replace(/dp\.(?:st|pt|sa|ct)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(
      /"(SecretAccessKey|SessionToken|AccessKeyId|password|uri)"\s*:\s*"[^"]*"/gi,
      '"$1":"redacted"',
    );
}

export function assertDatabaseUrl(url, { pooled }) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Database URL is invalid");
  }
  const refused = [
    "ep-young-wave",
    "ep-wild-paper",
    "proud-salad",
    "mute-credit",
    "br-round-night",
    "br-mute-shadow",
  ];
  if (refused.some((marker) => host.includes(marker))) {
    throw new Error("Refusing a Dyad or production database host");
  }
  if (pooled !== host.includes("-pooler")) {
    throw new Error("Database host does not match the requested pool mode");
  }
  return host;
}

export function runtimeEnvironment({ pooledUrl, secrets, appUrl }) {
  assertDatabaseUrl(pooledUrl, { pooled: true });
  const names = [
    "APP_PASSWORD",
    "AUTH_SECRET",
    "CRON_SECRET",
    "OPENROUTER_API_KEY",
  ];
  const env = { DATABASE_URL: pooledUrl, APP_URL: appUrl };
  for (const name of names) {
    const value = String(secrets?.[name] ?? "").trim();
    if (!value) throw new Error(`forma/dev is missing ${name}`);
    env[name] = value;
  }
  if (Object.keys(env).some((name) => name.startsWith("OPENAI_"))) {
    throw new Error("Refusing an OpenAI credential");
  }
  let parsed;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("Application URL is invalid");
  }
  if (
    parsed.protocol !== "http:" ||
    !parsed.hostname.startsWith("preview-forma-")
  ) {
    throw new Error(
      "Refusing an application URL outside the preview load balancer",
    );
  }
  return env;
}

export function assertDeletableBranch(branch, expectedName) {
  const target = assertFormaPreviewTarget({
    projectId: FORMA_NEON_PROJECT_ID,
    parentId: FORMA_PARENT_BRANCH_ID,
    branchName: expectedName,
  });
  if (!branch || branch.name !== expectedName) {
    throw new Error("Refusing to delete a branch other than this preview");
  }
  if (
    branch.id === FORMA_PARENT_BRANCH_ID ||
    branch.parent_id !== FORMA_PARENT_BRANCH_ID
  ) {
    throw new Error("Refusing to delete the parent branch");
  }
  if (String(branch.name).includes("forma-pr-")) {
    throw new Error("Refusing a Forma pull-request database");
  }
  return target;
}

export function serviceName(pr) {
  return formaPreviewBranchName(pr);
}

export function assertSchemaSql(sql) {
  const text = String(sql ?? "");
  if (!/CREATE TABLE IF NOT EXISTS login_attempts/i.test(text)) {
    throw new Error("Forma schema is missing login_attempts");
  }
  return text;
}

export function pgModuleHref(prefix = process.env.PREVIEW_FORMA_PG) {
  const value = String(prefix ?? "").trim();
  if (!value) return "pg";
  return pathToFileURL(
    `${value.replace(/\/$/, "")}/node_modules/pg/lib/index.js`,
  ).href;
}

export function taskDefinitionDocument({ host, image, environment }) {
  assertPreviewHost(host);
  return {
    family: "preview-forma",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "512",
    memory: "1024",
    executionRoleArn: host.executionRoleArn,
    containerDefinitions: [
      {
        name: "forma",
        image,
        essential: true,
        portMappings: [{ containerPort: 3000, protocol: "tcp" }],
        command: ["pnpm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"],
        environment: [
          ...Object.entries(environment).map(([name, value]) => ({
            name,
            value,
          })),
          { name: "HOSTNAME", value: "0.0.0.0" },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": host.logGroup,
            "awslogs-region": region,
            "awslogs-stream-prefix": "forma",
          },
        },
      },
    ],
  };
}

export function serviceDocument({ host, service, taskDefinitionArn }) {
  return {
    cluster: host.cluster,
    serviceName: service,
    taskDefinition: taskDefinitionArn,
    desiredCount: 1,
    launchType: "FARGATE",
    healthCheckGracePeriodSeconds: 180,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: host.subnetIds,
        securityGroups: [host.taskSecurityGroupId],
        assignPublicIp: "ENABLED",
      },
    },
    loadBalancers: [
      {
        targetGroupArn: host.targetGroupArn,
        containerName: "forma",
        containerPort: 3000,
      },
    ],
  };
}

export async function probePreview(appUrl, fetchImpl = fetch) {
  const statusResponse = await fetchImpl(`${appUrl}/api/status`);
  const statusBody = await statusResponse.json().catch(() => ({}));
  if (statusBody.configured !== true || statusBody.provider !== "openrouter") {
    throw new Error(
      `preview_forma_status=${statusResponse.status} configured=${statusBody.configured === true} provider=${statusBody.provider || "absent"}`,
    );
  }
  const passwordResponse = await fetchImpl(`${appUrl}/api/auth`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: appUrl,
    },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  if (passwordResponse.status !== 401) {
    const body = await passwordResponse.json().catch(() => ({}));
    throw new Error(
      `preview_forma_password=${passwordResponse.status} error=${body.error || "absent"}`,
    );
  }
  return {
    configured: true,
    provider: "openrouter",
    password: 401,
  };
}

async function neonRequest(apiKey, method, path, body, fetchImpl) {
  const response = await fetchImpl(`https://console.neon.tech/api/v2${path}`, {
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
    const code = payload?.code ? ` ${payload.code}` : "";
    throw new Error(
      `${method} ${path.split("?")[0]} ${response.status}${code} ${redact(payload?.message || text)}`,
    );
  }
  return payload;
}

export async function ensureNeonBranch({
  apiKey,
  pr,
  fetchImpl = fetch,
  sleep = async () => {},
}) {
  const name = formaPreviewBranchName(pr);
  assertFormaPreviewTarget({
    projectId: FORMA_NEON_PROJECT_ID,
    parentId: FORMA_PARENT_BRANCH_ID,
    branchName: name,
  });
  const branches = await listBranches(apiKey, fetchImpl);
  let branch = branches.find((item) => item.name === name);
  if (!branch) {
    log("preview_forma_branch_init=parent-data");
    const created = await neonRequest(
      apiKey,
      "POST",
      `/projects/${FORMA_NEON_PROJECT_ID}/branches`,
      {
        branch: {
          parent_id: FORMA_PARENT_BRANCH_ID,
          name,
          // A normal child copies the parent. schema-only and parent-schema
          // open a root branch, and this project is already at that limit.
          init_source: "parent-data",
        },
        endpoints: [{ type: "read_write" }],
      },
      fetchImpl,
    );
    branch = created.branch;
    for (const operation of created.operations || []) {
      let finished = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const current = await neonRequest(
          apiKey,
          "GET",
          `/projects/${FORMA_NEON_PROJECT_ID}/operations/${operation.id}`,
          undefined,
          fetchImpl,
        );
        const status = current.operation?.status;
        if (status === "finished") {
          finished = true;
          break;
        }
        if (status === "failed" || status === "cancelled") {
          throw new Error(`Neon operation ${status}`);
        }
        await sleep(2000);
      }
      if (!finished) throw new Error("Neon operation did not finish");
    }
  }
  if (!branch?.id || branch.id === FORMA_PARENT_BRANCH_ID) {
    throw new Error("Refusing to use the parent branch as the preview");
  }
  if (branch.parent_id && branch.parent_id !== FORMA_PARENT_BRANCH_ID) {
    throw new Error("Refusing a preview branch with the wrong parent");
  }
  const uriFor = async (pooled) => {
    const params = new URLSearchParams({
      branch_id: branch.id,
      database_name: "neondb",
      role_name: "neondb_owner",
      pooled: pooled ? "true" : "false",
    });
    let lastError;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const body = await neonRequest(
          apiKey,
          "GET",
          `/projects/${FORMA_NEON_PROJECT_ID}/connection_uri?${params}`,
          undefined,
          fetchImpl,
        );
        const uri = body.uri;
        assertDatabaseUrl(uri, { pooled });
        return uri;
      } catch (error) {
        if (/Refusing|invalid|pool mode/.test(String(error?.message))) {
          throw error;
        }
        lastError = error;
        await sleep(2000);
      }
    }
    throw lastError;
  };
  return {
    name,
    id: branch.id,
    direct: await uriFor(false),
    pooled: await uriFor(true),
  };
}

export async function deleteNeonBranch({ apiKey, pr, fetchImpl = fetch }) {
  const name = formaPreviewBranchName(pr);
  const branch = (await listBranches(apiKey, fetchImpl)).find(
    (item) => item.name === name,
  );
  if (!branch) return { deleted: false, name };
  assertDeletableBranch(branch, name);
  await neonRequest(
    apiKey,
    "DELETE",
    `/projects/${FORMA_NEON_PROJECT_ID}/branches/${branch.id}`,
    undefined,
    fetchImpl,
  );
  return { deleted: true, name };
}

function aws(args, env) {
  const result = spawnSync("aws", args, { encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error(
      `aws ${args[0]} ${args[1]} ${result.status} ${redact(`${result.stderr || ""}\n${result.stdout || ""}`)}`,
    );
  }
  return result.stdout || "";
}

function mask(value) {
  const text = String(value ?? "")
    .replace(/[\r\n]/g, "")
    .trim();
  if (text.length >= 8) writeSync(1, `::add-mask::${text}\n`);
}

async function downloadFormaDev(token, fetchImpl) {
  const response = await fetchImpl(
    "https://api.doppler.com/v3/configs/config/secrets/download?project=forma&config=dev&format=json",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok)
    throw new Error(`Doppler forma/dev download failed (${response.status})`);
  return response.json();
}

async function listBranches(apiKey, fetchImpl) {
  const branches = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const listed = await neonRequest(
      apiKey,
      "GET",
      `/projects/${FORMA_NEON_PROJECT_ID}/branches?${params}`,
      undefined,
      fetchImpl,
    );
    branches.push(...(listed.branches || []));
    const next = listed.pagination?.next;
    if (!next || next === cursor) break;
    cursor = String(next);
  }
  return branches;
}

async function applySchema(directUrl, schemaSql) {
  assertDatabaseUrl(directUrl, { pooled: false });
  const sql = assertSchemaSql(schemaSql);
  const loaded = await import(pgModuleHref());
  const Pool = loaded.Pool || loaded.default?.Pool;
  if (!Pool) throw new Error("Schema client is missing");
  const pool = new Pool({ connectionString: directUrl, max: 1 });
  try {
    await pool.query(sql);
  } catch (error) {
    throw new Error(`Schema apply failed ${redact(error?.message)}`);
  } finally {
    await pool.end();
  }
}

function roleEnv(credentials, baseEnv) {
  return {
    ...baseEnv,
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
}

function assume(userEnv) {
  const roleArn = `arn:aws:iam::${accountId}:role/preview-forma-deploy`;
  const assumed = JSON.parse(
    aws(
      [
        "sts",
        "assume-role",
        "--role-arn",
        roleArn,
        "--role-session-name",
        "preview-forma-launch",
        "--duration-seconds",
        "3600",
        "--output",
        "json",
      ],
      userEnv,
    ),
  );
  return roleEnv(assumed.Credentials, userEnv);
}

function assertAssumed(env) {
  const arn = aws(
    ["sts", "get-caller-identity", "--query", "Arn", "--output", "text"],
    env,
  ).trim();
  if (!arn.includes("preview-forma-deploy") || !arn.includes(accountId)) {
    throw new Error("Refusing to deploy without the preview-forma role");
  }
  log(`preview_forma_assumed=${arn}`);
  return arn;
}

function userEnvFromSecrets(secrets) {
  const accessKey = String(secrets.AWS_ACCESS_KEY_ID ?? "").trim();
  const secretKey = String(secrets.AWS_SECRET_ACCESS_KEY ?? "").trim();
  if (!accessKey || !secretKey) {
    throw new Error("Doppler aws/dev is missing the AWS key pair");
  }
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
  };
  delete env.AWS_SESSION_TOKEN;
  return env;
}

async function downloadAwsDev(token, fetchImpl) {
  const response = await fetchImpl(
    "https://api.doppler.com/v3/configs/config/secrets/download?project=aws&config=dev&format=json",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok)
    throw new Error(`Doppler aws/dev download failed (${response.status})`);
  return response.json();
}

async function pinnedImage() {
  const images = await readPinnedImages("deploy/preview-forma/compose.yml");
  if (images.length !== 1 || images[0].service !== "forma") {
    throw new Error("This launch runs the single pinned Forma image");
  }
  return images[0].image;
}

function log(line) {
  writeSync(1, `${redact(line)}\n`);
}

async function waitForHealthy(env, host, service, sleep) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const health = JSON.parse(
      aws(
        [
          "elbv2",
          "describe-target-health",
          "--target-group-arn",
          host.targetGroupArn,
          "--region",
          region,
          "--output",
          "json",
        ],
        env,
      ),
    );
    const states = (health.TargetHealthDescriptions ?? []).map(
      (item) => item.TargetHealth?.State,
    );
    log(`preview_forma_targets=${states.join(",") || "none"}`);
    if (states.includes("healthy")) return;
    if (attempt === 39) break;
    await sleep(15000);
  }
  const listed = JSON.parse(
    aws(
      [
        "ecs",
        "list-tasks",
        "--cluster",
        host.cluster,
        "--service-name",
        service,
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    ),
  );
  const taskArns = listed.taskArns ?? [];
  if (taskArns.length > 0) {
    const described = JSON.parse(
      aws(
        [
          "ecs",
          "describe-tasks",
          "--cluster",
          host.cluster,
          "--tasks",
          ...taskArns,
          "--region",
          region,
          "--output",
          "json",
        ],
        env,
      ),
    );
    for (const task of described.tasks ?? []) {
      log(
        `preview_forma_task_status=${task.lastStatus} reason=${task.stoppedReason || "none"}`,
      );
    }
  }
  throw new Error("Preview target did not become healthy");
}

function ensureService(env, host, service, taskDefinitionArn) {
  const described = JSON.parse(
    aws(
      [
        "ecs",
        "describe-services",
        "--cluster",
        host.cluster,
        "--services",
        service,
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    ),
  );
  const existing = (described.services ?? []).find(
    (item) => item.status === "ACTIVE",
  );
  if (!existing) {
    const document = serviceDocument({ host, service, taskDefinitionArn });
    aws(
      [
        "ecs",
        "create-service",
        "--cli-input-json",
        JSON.stringify(document),
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    );
    log(`preview_forma_service=created ${service}`);
    return;
  }
  aws(
    [
      "ecs",
      "update-service",
      "--cluster",
      host.cluster,
      "--service",
      service,
      "--task-definition",
      taskDefinitionArn,
      "--desired-count",
      "1",
      "--force-new-deployment",
      "--region",
      region,
      "--output",
      "json",
    ],
    env,
  );
  log(`preview_forma_service=updated ${service}`);
}

export async function startPreview({
  token,
  pr,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const host = assertPreviewHost(
    JSON.parse(readFileSync("deploy/preview-forma/host.json", "utf8")),
  );
  const image = await pinnedImage();
  const appUrl = `http://${host.albDns}`;
  const forma = await downloadFormaDev(token, fetchImpl);
  for (const value of Object.values(forma)) mask(value);
  const apiKey = String(forma.NEON_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("forma/dev is missing NEON_API_KEY");
  const branch = await ensureNeonBranch({ apiKey, pr, fetchImpl, sleep });
  mask(branch.direct);
  mask(branch.pooled);
  log(`preview_forma_branch=${branch.name}`);
  const schemaResponse = await fetchImpl(schemaUrl);
  if (!schemaResponse.ok) {
    throw new Error(`Forma schema download failed (${schemaResponse.status})`);
  }
  await applySchema(branch.direct, await schemaResponse.text());
  log("preview_forma_schema=ready");
  const environment = runtimeEnvironment({
    pooledUrl: branch.pooled,
    secrets: forma,
    appUrl,
  });
  for (const value of Object.values(environment)) mask(value);
  const awsDev = await downloadAwsDev(token, fetchImpl);
  mask(awsDev.AWS_SECRET_ACCESS_KEY);
  const env = assume(userEnvFromSecrets(awsDev));
  assertAssumed(env);
  const document = taskDefinitionDocument({ host, image, environment });
  const registered = JSON.parse(
    aws(
      [
        "ecs",
        "register-task-definition",
        "--cli-input-json",
        JSON.stringify(document),
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    ),
  );
  const taskDefinitionArn = registered.taskDefinition.taskDefinitionArn;
  log(`preview_forma_task_definition=${taskDefinitionArn}`);
  const service = serviceName(pr);
  ensureService(env, host, service, taskDefinitionArn);
  await waitForHealthy(env, host, service, sleep);
  let probed;
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      probed = await probePreview(appUrl, fetchImpl);
      break;
    } catch (error) {
      lastError = error;
      log(redact(error?.message));
      await sleep(10000);
    }
  }
  if (!probed) throw lastError;
  log(`preview_forma_status=200 configured=true provider=${probed.provider}`);
  log(`preview_forma_password=${probed.password}`);
  log(`preview_forma_url=${appUrl}`);
  return { appUrl, service, branch: branch.name };
}

export async function stopPreview({ token, pr, fetchImpl = fetch }) {
  const host = assertPreviewHost(
    JSON.parse(readFileSync("deploy/preview-forma/host.json", "utf8")),
  );
  const service = serviceName(pr);
  const awsDev = await downloadAwsDev(token, fetchImpl);
  mask(awsDev.AWS_SECRET_ACCESS_KEY);
  const env = assume(userEnvFromSecrets(awsDev));
  assertAssumed(env);
  try {
    aws(
      [
        "ecs",
        "delete-service",
        "--cluster",
        host.cluster,
        "--service",
        service,
        "--force",
        "--region",
        region,
        "--output",
        "json",
      ],
      env,
    );
    log(`preview_forma_service=deleted ${service}`);
  } catch (error) {
    if (!String(error.message).includes("ServiceNotFound")) throw error;
    log(`preview_forma_service=absent ${service}`);
  }
  const forma = await downloadFormaDev(token, fetchImpl);
  mask(forma.NEON_API_KEY);
  const deleted = await deleteNeonBranch({
    apiKey: String(forma.NEON_API_KEY ?? "").trim(),
    pr,
    fetchImpl,
  });
  log(
    `preview_forma_branch=${deleted.deleted ? "deleted" : "absent"} ${deleted.name}`,
  );
  return deleted;
}

function requirePr() {
  const pr = String(process.env.PR ?? "").trim();
  if (!/^[0-9]+$/.test(pr))
    throw new Error("Pull request number must be digits");
  return pr;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const mode = process.argv[2];
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  if (!token) {
    log("DOPPLER_ADMIN_TOKEN=absent");
    process.exit(1);
  }
  const action =
    mode === "up"
      ? startPreview({ token, pr: requirePr() })
      : mode === "down"
        ? stopPreview({ token, pr: requirePr() })
        : Promise.reject(new Error("Usage: launch.mjs up|down"));
  action.catch((error) => {
    log(redact(error?.message || String(error)));
    process.exit(1);
  });
}
