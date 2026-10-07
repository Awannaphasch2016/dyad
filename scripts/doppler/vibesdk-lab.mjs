// Isolated vibeSDK lab names and the Wrangler config for that lab.
// Production resource ids are refusal checks. This module does not call Cloudflare.

export const LAB_WORKER_NAME = "vibesdk-lab";
export const LAB_GATEWAY_ID = "vibesdk-lab";
export const LAB_D1_NAME = "vibesdk-lab";
export const LAB_KV_TITLE = "vibesdk-lab";
export const LAB_R2_NAME = "vibesdk-lab-templates";
export const LAB_CONFIG_NAME = "wrangler.jsonc";
export const VIBESDK_SHA = "9da158d82c597a0e8f4bf033cdccd1053fb6fb15";
export const LAB_PROMPT =
  "Reply with the single word pong. Do not write files.";

export const requiredLabSecrets = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "ANTHROPIC_API_KEY",
];

export const optionalLabSecrets = ["OPENROUTER_API_KEY"];

export const PRODUCTION_DATABASE_ID = "c4721a2b-b96a-428a-8b2a-b3d255b307e9";
export const PRODUCTION_KV_ID = "f066f3c2e4824981b48e8586c04db9c1";
export const PRODUCTION_WORKER_NAME = "vibesdk-production";
export const PRODUCTION_D1_NAME = "vibesdk-db";
export const PRODUCTION_R2_NAME = "vibesdk-templates";

export function gatewayCreateBody() {
  return {
    id: LAB_GATEWAY_ID,
    cache_invalidate_on_update: true,
    cache_ttl: 0,
    collect_logs: true,
    rate_limiting_interval: 0,
    rate_limiting_limit: 0,
  };
}

export function providerConfigBody(secret) {
  return {
    alias: "default",
    default_config: true,
    provider_slug: "anthropic",
    secret,
  };
}

export function d1CreateBody() {
  return { name: LAB_D1_NAME };
}

export function kvCreateBody() {
  return { title: LAB_KV_TITLE };
}

export function r2CreateBody() {
  return { name: LAB_R2_NAME };
}

export function rowsOf(payload) {
  const result = payload?.result;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.buckets)) return result.buckets;
  return [];
}

export function findNamed(rows, field, expected) {
  return (rows ?? []).find((row) => row?.[field] === expected) ?? null;
}

export function d1Id(row) {
  return String(row?.uuid ?? row?.database_id ?? "");
}

export function labWranglerConfig({ accountId, databaseId, kvId }) {
  if (!accountId || !databaseId || !kvId) {
    throw new Error("lab bindings are incomplete");
  }
  if (
    databaseId === PRODUCTION_DATABASE_ID ||
    databaseId === PRODUCTION_D1_NAME
  ) {
    throw new Error("refusing production d1");
  }
  if (kvId === PRODUCTION_KV_ID) {
    throw new Error("refusing production kv");
  }
  return {
    name: LAB_WORKER_NAME,
    main: "worker/index.ts",
    alias: {
      "artifacts-viewer":
        "./packages/artifacts-viewer/packages/artifacts-viewer/src/index.ts",
      "artifacts-viewer/server/cache":
        "./packages/artifacts-viewer/packages/artifacts-viewer/src/server/cache-adapters.ts",
    },
    compatibility_date: "2026-05-23",
    compatibility_flags: ["nodejs_compat"],
    keep_vars: true,
    rules: [
      {
        type: "Text",
        globs: ["**/*.md", "**/*.md?raw"],
        fallthrough: true,
      },
    ],
    version_metadata: { binding: "CF_VERSION_METADATA" },
    assets: {
      directory: "dist/client",
      not_found_handling: "single-page-application",
      run_worker_first: true,
      binding: "ASSETS",
    },
    observability: {
      enabled: true,
      logs: { enabled: true, invocation_logs: true },
    },
    unsafe: {
      bindings: [
        {
          name: "API_RATE_LIMITER",
          type: "ratelimit",
          namespace_id: "2101",
          simple: { limit: 10000, period: 60 },
        },
        {
          name: "AUTH_RATE_LIMITER",
          type: "ratelimit",
          namespace_id: "2102",
          simple: { limit: 1000, period: 60 },
        },
      ],
    },
    worker_loaders: [{ binding: "LOADER" }],
    d1_databases: [
      {
        binding: "DB",
        database_name: LAB_D1_NAME,
        database_id: databaseId,
        migrations_dir: "migrations",
      },
    ],
    durable_objects: {
      bindings: [
        { class_name: "CodeGeneratorAgent", name: "CodeGenObject" },
        { class_name: "DORateLimitStore", name: "DORateLimitStore" },
        { class_name: "UserSecretsStore", name: "UserSecretsStore" },
        { class_name: "ThinkAgent", name: "THINK_DO" },
        { class_name: "SpaceDO", name: "SPACE_DO" },
      ],
    },
    r2_buckets: [{ binding: "TEMPLATES_BUCKET", bucket_name: LAB_R2_NAME }],
    kv_namespaces: [{ binding: "VibecoderStore", id: kvId }],
    migrations: [
      { tag: "v1", new_sqlite_classes: ["CodeGeneratorAgent"] },
      { tag: "v2", new_sqlite_classes: ["DORateLimitStore"] },
      { tag: "v3", new_sqlite_classes: ["UserSecretsStore"] },
      { tag: "v5", new_sqlite_classes: ["SpaceDO"] },
      { tag: "v6", new_sqlite_classes: ["ThinkAgent"] },
    ],
    vars: {
      TEMPLATES_REPOSITORY: "https://github.com/cloudflare/vibesdk-templates",
      CLOUDFLARE_AI_GATEWAY: LAB_GATEWAY_ID,
      CLOUDFLARE_AI_GATEWAY_URL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${LAB_GATEWAY_ID}/compat`,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      ENABLE_EMAIL_AUTH: "true",
      PLATFORM_CAPABILITIES: {
        features: {
          app: { enabled: true },
          presentation: { enabled: false },
          general: { enabled: false },
        },
        version: "1.0.0",
      },
      CUSTOM_DOMAIN: "",
    },
    workers_dev: true,
    preview_urls: false,
  };
}

export function labConfigViolations(config) {
  const violations = [];
  if (config?.name !== LAB_WORKER_NAME) violations.push("name");
  if (config?.workers_dev !== true) violations.push("workers_dev");
  if (config?.routes) violations.push("routes");
  if (config?.containers) violations.push("containers");
  if (config?.dispatch_namespaces) violations.push("dispatch");
  if (config?.artifacts) violations.push("artifacts");
  if (config?.ai) violations.push("ai");
  if (config?.browser) violations.push("browser");
  const database = config?.d1_databases?.[0];
  if (database?.database_name !== LAB_D1_NAME) violations.push("d1_name");
  if (database?.database_id === PRODUCTION_DATABASE_ID)
    violations.push("d1_id");
  if (config?.r2_buckets?.[0]?.bucket_name !== LAB_R2_NAME) {
    violations.push("r2");
  }
  if (config?.kv_namespaces?.[0]?.id === PRODUCTION_KV_ID) {
    violations.push("kv");
  }
  const classes = (config?.durable_objects?.bindings ?? []).map(
    (binding) => binding.class_name,
  );
  if (classes.includes("UserAppSandboxService")) violations.push("sandbox");
  if (config?.vars?.CLOUDFLARE_AI_GATEWAY !== LAB_GATEWAY_ID) {
    violations.push("gateway");
  }
  if (config?.vars?.DISPATCH_NAMESPACE) violations.push("dispatch_var");
  if (config?.vars?.ARTIFACTS_NAMESPACE) violations.push("artifacts_var");
  const text = JSON.stringify(config ?? {});
  if (text.includes(PRODUCTION_WORKER_NAME)) violations.push("production_name");
  if (text.includes("build.cloudflare.dev"))
    violations.push("production_route");
  if (text.includes("vibesdk-default-namespace")) violations.push("namespace");
  return violations;
}

export function patchThinkModel(source) {
  const next = source
    .replace(
      "export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';",
      "export const THINK_MODEL_ID = 'anthropic/claude-sonnet-4-5';",
    )
    .replace("name: 'Gemini 3.6 Flash',", "name: 'Claude Sonnet 4.5',")
    .replace("provider: 'google-ai-studio',", "provider: 'anthropic',");
  if (
    next.includes("gemini") ||
    next.includes("google-ai-studio") ||
    !next.includes("anthropic/claude-sonnet-4-5")
  ) {
    throw new Error("think model patch did not apply");
  }
  return next;
}

export function patchWorkerExports(source) {
  const line =
    "export { UserAppSandboxService } from './services/sandbox/sandboxSdkClient';";
  if (!source.includes(line)) {
    throw new Error("sandbox export is missing");
  }
  const next = source.replace(line, "");
  if (next.includes(line)) {
    throw new Error("sandbox export remains");
  }
  return next;
}

export function parseWorkersDevUrl(log) {
  const match = String(log).match(
    /https:\/\/vibesdk-lab\.[a-z0-9-]+\.workers\.dev/i,
  );
  return match ? match[0] : "";
}

export function storeCookies(jar, setCookieLines) {
  for (const line of setCookieLines ?? []) {
    const [pair] = String(line).split(";");
    const eq = pair.indexOf("=");
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    jar[name] = value;
  }
  return jar;
}

export function csrfTokenFromJar(jar) {
  const raw = jar?.["csrf-token"];
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === "string" ? parsed.token : "";
  } catch {
    return raw;
  }
}

export function promptOutcome(text) {
  let agent = "absent";
  let error = "";
  let reply = "absent";
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row?.agentId) agent = "present";
      if (row?.error?.message) error = String(row.error.message);
      const blob = JSON.stringify(row);
      if (/\bpong\b/i.test(blob)) reply = "pong";
    } catch {
      if (/\bpong\b/i.test(trimmed)) reply = "pong";
    }
  }
  return { agent, error, reply };
}

export function labPassword(randomText) {
  return `Aa1${randomText}`;
}
