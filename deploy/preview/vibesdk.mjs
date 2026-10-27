// Vibe SDK preview names and Wrangler config.
// This module does not call Cloudflare. Dyad's Neon module is not used here.

export const VIBESDK_PREVIEW_LABEL = "preview-vibesdk";
export const VIBESDK_SHA = "9da158d82c597a0e8f4bf033cdccd1053fb6fb15";
export const WORKERS_SUBDOMAIN = "karant-test-egress-canary";
export const PREVIEW_COMMENT_MARKER = "<!-- vibesdk-preview -->";
export const BUILDER_NOTE =
  "This preview is the builder. An app generated inside it does not get its own public URL.";

export const LAB_WORKER_NAME = "vibesdk-lab";
export const LAB_D1_NAME = "vibesdk-lab";
export const LAB_R2_NAME = "vibesdk-lab-templates";
export const LAB_D1_ID = "9c385a59-07fd-4ea3-9b3a-e32f3afb3bf6";
export const LAB_KV_ID = "57a805d04a824bb9bc51f280235aee3a";
export const PRODUCTION_DATABASE_ID = "c4721a2b-b96a-428a-8b2a-b3d255b307e9";
export const PRODUCTION_KV_ID = "f066f3c2e4824981b48e8586c04db9c1";
export const PRODUCTION_WORKER_NAME = "vibesdk-production";
export const PRODUCTION_D1_NAME = "vibesdk-db";
export const PRODUCTION_R2_NAME = "vibesdk-templates";
export const PRODUCTION_ROUTE = "build.cloudflare.dev";

const refusedNames = [
  LAB_WORKER_NAME,
  LAB_D1_NAME,
  LAB_R2_NAME,
  PRODUCTION_WORKER_NAME,
  PRODUCTION_D1_NAME,
  PRODUCTION_R2_NAME,
  PRODUCTION_ROUTE,
  "vibesdk-default-namespace",
];

const refusedIds = new Set([
  LAB_D1_ID,
  LAB_KV_ID,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_KV_ID,
]);

export function previewNames(pr) {
  if (!/^[0-9]+$/.test(String(pr))) {
    throw new Error("Pull request number is required");
  }
  const worker = `vibesdk-pr-${pr}`;
  const host = `${worker}.${WORKERS_SUBDOMAIN}.workers.dev`;
  return {
    pr: String(pr),
    worker,
    d1: worker,
    kv: worker,
    r2: worker,
    host,
    url: `https://${host}`,
  };
}

export function assertSafePreview(names) {
  const expected = previewNames(names?.pr);
  for (const key of ["pr", "worker", "d1", "kv", "r2", "host", "url"]) {
    if (names?.[key] !== expected[key]) {
      throw new Error("refusing preview name");
    }
  }
  const blob = JSON.stringify(names);
  for (const refused of refusedNames) {
    if (blob.includes(refused)) throw new Error(`refusing ${refused}`);
  }
}

export function assertAccountId(accountId) {
  if (!/^[a-f0-9]{32}$/.test(String(accountId ?? ""))) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not available");
  }
}

export function assertResourceId(id, kind) {
  const value = String(id ?? "");
  if (!value) throw new Error(`refusing empty ${kind}`);
  if (value === PRODUCTION_DATABASE_ID || value === PRODUCTION_KV_ID) {
    throw new Error(`refusing production ${kind}`);
  }
  if (value === LAB_D1_ID || value === LAB_KV_ID) {
    throw new Error(`refusing lab ${kind}`);
  }
  if (refusedIds.has(value)) throw new Error(`refusing ${kind}`);
}

export function secretReady(value) {
  const text = String(value ?? "").trim();
  if (!text || text.startsWith("${") || /[\r\n]/.test(text)) return false;
  return text.length >= 20;
}

export function previewWranglerConfig({ accountId, databaseId, kvId, names }) {
  assertAccountId(accountId);
  assertSafePreview(names);
  assertResourceId(databaseId, "d1");
  assertResourceId(kvId, "kv");
  return {
    name: names.worker,
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
          namespace_id: `${names.pr}01`,
          simple: { limit: 10000, period: 60 },
        },
        {
          name: "AUTH_RATE_LIMITER",
          type: "ratelimit",
          namespace_id: `${names.pr}02`,
          simple: { limit: 1000, period: 60 },
        },
      ],
    },
    worker_loaders: [{ binding: "LOADER" }],
    d1_databases: [
      {
        binding: "DB",
        database_name: names.d1,
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
    r2_buckets: [{ binding: "TEMPLATES_BUCKET", bucket_name: names.r2 }],
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
      CLOUDFLARE_ACCOUNT_ID: accountId,
      ENABLE_EMAIL_AUTH: "false",
      PLATFORM_CAPABILITIES: {
        features: {
          app: { enabled: true },
          presentation: { enabled: false },
          general: { enabled: false },
        },
        version: "1.0.0",
      },
      CUSTOM_DOMAIN: names.host,
    },
    workers_dev: true,
    preview_urls: false,
  };
}

export function previewConfigViolations(config, names) {
  const violations = [];
  if (config?.name !== names.worker) violations.push("name");
  if (config?.workers_dev !== true) violations.push("workers_dev");
  if (config?.routes) violations.push("routes");
  if (config?.containers) violations.push("containers");
  if (config?.dispatch_namespaces) violations.push("dispatch");
  if (config?.artifacts) violations.push("artifacts");
  if (config?.ai) violations.push("ai");
  if (config?.browser) violations.push("browser");
  const database = config?.d1_databases?.[0];
  if (database?.database_name !== names.d1) violations.push("d1_name");
  if (refusedIds.has(database?.database_id)) violations.push("d1_id");
  if (config?.r2_buckets?.[0]?.bucket_name !== names.r2) violations.push("r2");
  if (refusedIds.has(config?.kv_namespaces?.[0]?.id)) violations.push("kv");
  const classes = (config?.durable_objects?.bindings ?? []).map(
    (binding) => binding.class_name,
  );
  if (classes.includes("UserAppSandboxService")) violations.push("sandbox");
  if (config?.vars?.CUSTOM_DOMAIN !== names.host) violations.push("domain");
  if (config?.vars?.CLOUDFLARE_AI_GATEWAY) violations.push("gateway");
  if (config?.vars?.DISPATCH_NAMESPACE) violations.push("dispatch_var");
  if (config?.vars?.ARTIFACTS_NAMESPACE) violations.push("artifacts_var");
  const text = JSON.stringify(config ?? {}).replace(
    "https://github.com/cloudflare/vibesdk-templates",
    "",
  );
  for (const refused of refusedNames) {
    if (text.includes(refused)) violations.push(refused);
  }
  for (const id of refusedIds) {
    if (text.includes(id)) violations.push(id);
  }
  return violations;
}

export function patchWorkerExports(source) {
  const line =
    "export { UserAppSandboxService } from './services/sandbox/sandboxSdkClient';";
  if (!source.includes(line)) {
    throw new Error("sandbox export is missing");
  }
  const next = source.replace(line, "");
  if (next.includes(line)) throw new Error("sandbox export remains");
  return next;
}

export function previewCommentBody(kind, names) {
  if (names) assertSafePreview(names);
  const marker = PREVIEW_COMMENT_MARKER;
  if (kind === "provisioning") {
    return `${marker}\nVibe SDK preview is provisioning.\n\n${BUILDER_NOTE}`;
  }
  if (kind === "ready") {
    return `${marker}\nVibe SDK preview: ${names.url}\n\n${BUILDER_NOTE}`;
  }
  if (kind === "removed") {
    return `${marker}\nRemoved Vibe SDK preview ${names.url}.`;
  }
  if (kind === "failed") {
    return `${marker}\nVibe SDK preview was not updated.`;
  }
  if (kind === "cleanup-failed") {
    const url = names?.url ? `\n\n${names.url}` : "";
    return `${marker}\nVibe SDK preview cleanup did not finish.${url}`;
  }
  throw new Error("unknown preview comment");
}
