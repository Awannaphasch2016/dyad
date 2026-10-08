// Vibe SDK preview names, Wrangler config, and Think patches.
// This module does not call Cloudflare. Dyad's Neon module is not used here.

export const VIBESDK_PREVIEW_LABEL = "preview-vibesdk";
export const VIBESDK_SHA = "9da158d82c597a0e8f4bf033cdccd1053fb6fb15";
export const WORKERS_SUBDOMAIN = "karant-test-egress-canary";
export const THINK_MODEL_ID = "anthropic/claude-sonnet-4.5";
export const THINK_PROVIDER = "openrouter";
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
      ENABLE_EMAIL_AUTH: "true",
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

export function patchThinkModel(source) {
  const next = source
    .replace(
      "export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';",
      `export const THINK_MODEL_ID = '${THINK_MODEL_ID}';`,
    )
    .replace("name: 'Gemini 3.6 Flash',", "name: 'Claude Sonnet 4.5',")
    .replace(
      "provider: 'google-ai-studio',",
      `provider: '${THINK_PROVIDER}',\n\tdirectOverride: true,`,
    );
  if (
    next.includes("gemini") ||
    next.includes("google-ai-studio") ||
    next.includes("provider: 'anthropic'") ||
    next.includes("anthropic/claude-sonnet-4-5") ||
    !next.includes(`'${THINK_MODEL_ID}'`) ||
    !next.includes(`provider: '${THINK_PROVIDER}'`) ||
    !next.includes("directOverride: true")
  ) {
    throw new Error("think model patch did not apply");
  }
  return next;
}

export function patchThinkRouting(source) {
  const usesStoredKeys =
    "const usesStoredKeys = !conf.defaultHeaders?.['cf-aig-authorization'];";
  const gatewayHeader =
    "if (gatewayToken && !headers['cf-aig-authorization']) {";
  const gatewayUrl =
    "if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY) {";
  const buildStart = "async build(): Promise<void> {\n";
  if (
    !source.includes(usesStoredKeys) ||
    !source.includes(gatewayHeader) ||
    !source.includes(gatewayUrl) ||
    !source.includes(buildStart)
  ) {
    throw new Error("think routing patch did not match");
  }
  const next = source
    .replace(
      usesStoredKeys,
      "const directOpenRouter = aiModelConfig.provider === 'openrouter';\n\t\tconst usesStoredKeys = directOpenRouter ? false : !conf.defaultHeaders?.['cf-aig-authorization'];",
    )
    .replace(
      gatewayHeader,
      "if (!directOpenRouter && gatewayToken && !headers['cf-aig-authorization']) {",
    )
    .replace(
      gatewayUrl,
      "if (!directOpenRouter && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY) {",
    )
    .replace(
      buildStart,
      "async build(): Promise<void> {\n\t\tawait this.configureThinkAgent();\n",
    );
  if (
    !next.includes("directOpenRouter") ||
    next.includes(usesStoredKeys) ||
    next.includes(gatewayHeader) ||
    next.includes(gatewayUrl) ||
    !next.includes("await this.configureThinkAgent();")
  ) {
    throw new Error("think routing patch did not apply");
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
  if (next.includes(line)) throw new Error("sandbox export remains");
  return next;
}

export function patchAppCreationLimit(source) {
  const block = "appCreation: {\n\t\tenabled: true,";
  if (!source.includes(block)) {
    throw new Error("app creation limit patch did not match");
  }
  const next = source.replace(block, "appCreation: {\n\t\tenabled: false,");
  if (
    next.includes(block) ||
    !next.includes("appCreation: {\n\t\tenabled: false,")
  ) {
    throw new Error("app creation limit patch did not apply");
  }
  return next;
}

const STATIC_WEB_EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "mjs",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "woff",
  "woff2",
  "ttf",
]);

export function commitHasAppClass(files) {
  return Object.entries(files ?? {}).some(([path, content]) => {
    if (typeof content !== "string") return false;
    if (!/\.(ts|tsx|js|mjs|jsx)$/.test(path)) return false;
    return /export class App\b/.test(content);
  });
}

export function collectStaticWebAssets(files) {
  const assets = {};
  for (const [path, content] of Object.entries(files ?? {})) {
    if (typeof content !== "string") continue;
    const parts = path.split("/");
    if (parts.some((part) => part.startsWith(".") || part === "node_modules")) {
      continue;
    }
    const leaf = parts[parts.length - 1] ?? "";
    const dot = leaf.lastIndexOf(".");
    if (dot < 1) continue;
    const extension = leaf.slice(dot + 1).toLowerCase();
    if (!STATIC_WEB_EXTENSIONS.has(extension)) continue;
    assets[path.startsWith("/") ? path : `/${path}`] = content;
  }
  return assets;
}

export function previewProbeDecision(status) {
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 500 ||
    status === 503
  ) {
    return "terminal";
  }
  if (status >= 200 && status < 300) return "ready";
  return "retry";
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label} patch did not match`);
  }
  const next = source.replace(from, to);
  if (next === source) {
    throw new Error(`${label} patch did not apply`);
  }
  return next;
}

export function patchStaticSiteDeploy(source) {
  const helper = `const STATIC_WEB_EXTENSIONS = new Set([
  "html", "css", "js", "mjs", "svg", "png", "jpg", "jpeg", "gif", "webp", "ico", "woff", "woff2", "ttf",
])

function commitHasAppClass(files: Record<string, string>): boolean {
  return Object.entries(files).some(([path, content]) =>
    /\\.(ts|tsx|js|mjs|jsx)$/.test(path) && /export class App\\b/.test(content),
  )
}

function collectStaticWebAssets(files: Record<string, string>): Record<string, string> {
  const assets: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/")
    if (parts.some((part) => part.startsWith(".") || part === "node_modules")) continue
    const leaf = parts[parts.length - 1] ?? ""
    const dot = leaf.lastIndexOf(".")
    if (dot < 1) continue
    const extension = leaf.slice(dot + 1).toLowerCase()
    if (!STATIC_WEB_EXTENSIONS.has(extension)) continue
    assets[path.startsWith("/") ? path : \`/\${path}\`] = content
  }
  return assets
}

`;
  const earlyReturn = `try {
    if (!commitHasAppClass(files)) {
      return {
        branch,
        commitHash,
        mainModule: "__vibesdk_static_site__",
        modules: { "__vibesdk_static_site__.js": "export {}" },
        assets: collectStaticWebAssets(files),
        assetConfig: {
          html_handling: "auto-trailing-slash",
          not_found_handling: "none",
        },
        compatibilityDate: wranglerCfg.compatibilityDate ?? "2025-04-01",
      }
    }
    const assetsDir = wranglerCfg.assets?.directory?.replace(/^\\.?\\//, "").replace(/\\/$/, "")`;
  let next = replaceOnce(
    source,
    "export async function buildBranchDeployment(",
    `${helper}export async function buildBranchDeployment(`,
    "static site deploy helper",
  );
  next = replaceOnce(
    next,
    'try {\n    const assetsDir = wranglerCfg.assets?.directory?.replace(/^\\.?\\//, "").replace(/\\/$/, "")',
    earlyReturn,
    "static site deploy return",
  );
  if (!next.includes('mainModule: "__vibesdk_static_site__"')) {
    throw new Error("static site deploy patch did not apply");
  }
  return next;
}

export function patchPreviewServing(source) {
  let next = replaceOnce(
    source,
    "    let appClass: DurableObjectClass\n",
    `    if (dep.mainModule === "__vibesdk_static_site__") {
      return new Response("Preview cannot show this page.", { status: 404 })
    }

    let appClass: DurableObjectClass
`,
    "static site preview",
  );
  next = replaceOnce(
    next,
    `  if (!ct.includes("text/html")) return response

  // Use HTMLRewriter to prefix root-relative src/href/action attributes
`,
    `  if (!ct.includes("text/html")) return response
  if (response.body === null) return response

  // Use HTMLRewriter to prefix root-relative src/href/action attributes
`,
    "preview head rewrite",
  );
  return next;
}

export function patchPreviewPane(source) {
  let next = replaceOnce(
    source,
    "const MAX_RETRIES = 10;\nconst REDEPLOY_AFTER_ATTEMPT = 8;\n",
    "const MAX_RETRIES = 3;\n",
    "preview retry cap",
  );
  next = replaceOnce(
    next,
    "Promise<'sandbox' | 'dispatcher' | null>",
    "Promise<'sandbox' | 'dispatcher' | 'terminal' | null>",
    "preview probe type",
  );
  next = replaceOnce(
    next,
    `				if (!response.ok) {
					console.log('Preview not ready (status:', response.status, ')');
					return null;
				}`,
    `				if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 500 || response.status === 503) {
					console.log('Preview cannot be shown (status:', response.status, ')');
					return 'terminal';
				}

				if (!response.ok) {
					console.log('Preview not ready (status:', response.status, ')');
					return null;
				}`,
    "preview terminal status",
  );
  next = replaceOnce(
    next,
    `			const previewType = await testAvailability(url);

			if (previewType) {`,
    `			const previewType = await testAvailability(url);

			if (previewType === 'terminal') {
				setLoadState({
					status: 'error',
					attempt: attempt + 1,
					loadedSrc: null,
					errorMessage: 'Preview cannot show this snapshot.',
				});
				return;
			}

			if (previewType) {`,
    "preview terminal state",
  );
  next = replaceOnce(
    next,
    `				console.log(\`Preview not ready. Retrying in \${Math.ceil(delay / 1000)}s (attempt \${nextAttempt}/\${MAX_RETRIES})\`);

				// Auto-redeploy after 3 failed attempts
				if (nextAttempt === REDEPLOY_AFTER_ATTEMPT) {
					requestRedeploy();
				}

				// Schedule next retry`,
    `				console.log(\`Preview not ready. Retrying in \${Math.ceil(delay / 1000)}s (attempt \${nextAttempt}/\${MAX_RETRIES})\`);

				// Schedule next retry`,
    "preview redeploy",
  );
  next = replaceOnce(
    next,
    "		}, [testAvailability, requestScreenshot, requestRedeploy]);",
    "		}, [testAvailability, requestScreenshot]);",
    "preview retry deps",
  );
  next = replaceOnce(
    next,
    `		/**
		 * Request automatic redeployment via WebSocket
		 */
		const requestRedeploy = useCallback(() => {
			if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
				console.warn('Cannot request redeploy: WebSocket not connected');
				return;
			}

			if (hasRequestedRedeployRef.current) {
				console.log('Redeploy already requested, skipping duplicate request');
				return;
			}

			console.log('Requesting automatic preview redeployment');

			try {
				webSocket.send(JSON.stringify({
					type: 'preview',
				}));
				hasRequestedRedeployRef.current = true;
			} catch (error) {
				console.error('Failed to send redeploy request:', error);
			}
		}, [webSocket]);

`,
    "",
    "preview redeploy callback",
  );
  next = replaceOnce(
    next,
    `			const delay = getRetryDelay(loadState.attempt - 1);
			const delaySeconds = Math.ceil(delay / 1000);

			return (`,
    "			return (",
    "preview countdown",
  );
  next = replaceOnce(
    next,
    `						<RefreshCw className="size-8 text-kumo-brand animate-spin mx-auto mb-4" />
						<h3 className="text-lg font-medium text-text-primary mb-2">
							Loading Preview
						</h3>
						<p className="text-text-primary/70 text-sm mb-4">
							{loadState.attempt === 0
								? 'Checking if your deployed preview is ready...'
								: \`Preview not ready yet. Retrying in \${delaySeconds}s... (attempt \${loadState.attempt}/\${MAX_RETRIES})\`
							}
						</p>
						{loadState.attempt >= REDEPLOY_AFTER_ATTEMPT && (
							<p className="text-xs text-kumo-brand/70">
								Auto-redeployment triggered to refresh the preview
							</p>
						)}
						<div className="text-xs text-text-primary/50 mt-2">
							Preview URLs may take a moment to become available after deployment
						</div>`,
    `						<RefreshCw aria-hidden="true" className="size-8 text-kumo-brand animate-spin motion-reduce:animate-none mx-auto mb-4" />
						<h3 className="text-lg font-medium text-text-primary mb-2">
							Opening preview
						</h3>
						<p className="text-text-primary/70 text-sm mb-4" role="status" aria-live="polite">
							{loadState.attempt <= 1
								? 'Opening preview.'
								: 'The preview is still starting.'
							}
						</p>`,
    "preview opening copy",
  );
  next = replaceOnce(
    next,
    `					<h3 className="text-lg font-medium text-text-primary mb-2">
						Preview Not Available
					</h3>
					<p className="text-text-primary/70 text-sm mb-6">
						{loadState.errorMessage || 'The preview failed to load after multiple attempts.'}
					</p>`,
    `					<h3 className="text-lg font-medium text-text-primary mb-2">
						Preview not available
					</h3>
					<p className="text-text-primary/70 text-sm mb-6" role="status" aria-live="polite">
						{loadState.errorMessage || 'Preview cannot show this snapshot.'}
					</p>`,
    "preview error copy",
  );
  next = replaceOnce(
    next,
    `						<p className="text-xs text-text-primary/60">
							If the issue persists, please describe the problem in chat so I can help diagnose and fix it.
						</p>
`,
    "",
    "preview chat prompt",
  );
  if (
    next.includes("REDEPLOY_AFTER_ATTEMPT") ||
    next.includes("Preview not ready yet") ||
    next.includes("describe the problem in chat") ||
    !next.includes("return 'terminal'") ||
    !next.includes("Preview cannot show this snapshot.")
  ) {
    throw new Error("preview pane patch did not apply");
  }
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
  throw new Error("unknown preview comment");
}
