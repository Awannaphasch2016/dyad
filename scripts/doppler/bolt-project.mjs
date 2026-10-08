// Layout for the Doppler project bolt.
// References point at vibesdk/dev. This module does not copy secret values.

export const BOLT_PROJECT_NAME = "bolt";
export const VIBESDK_PROJECT_NAME = "vibesdk";
export const VIBESDK_DEV_CONFIG = "dev";

export const OPEN_ROUTER_API_KEY = "OPEN_ROUTER_API_KEY";

export const openRouterSourceNames = [
  "OPEN_ROUTER_API_KEY",
  "OPENROUTER_API_KEY",
];

// Dev and preview only. Production configs are skipped by the caller.
export const openRouterSearchOrder = [
  { project: "vibesdk", config: "dev" },
  { project: "dyad", config: "dev" },
  { project: "dyad", config: "preview" },
  { project: "forma", config: "dev" },
  { project: "forma", config: "preview" },
];

export const boltPreviewSecretNames = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  OPEN_ROUTER_API_KEY,
];

export const boltHitlSecretNames = [
  "WEWEBPLUS_DATABASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "GAS_CITY_HOST_BRIDGE_TOKEN",
];

export function githubEnvAssignment(name, value) {
  if (
    !boltPreviewSecretNames.includes(name) &&
    !boltHitlSecretNames.includes(name)
  ) {
    throw new Error(`refusing to export ${name}`);
  }
  const text = String(value ?? "");
  if (text.length === 0 || text.includes("\n")) {
    throw new Error(`${name} is absent or not a single line`);
  }
  const marker = `BOLT_${name}_EOF`;
  return `${name}<<${marker}\n${text}\n${marker}\n`;
}

export const cloudflareSecrets = [
  {
    dest: "CLOUDFLARE_API_TOKEN",
    sources: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN_"],
  },
  {
    dest: "CLOUDFLARE_ACCOUNT_ID",
    sources: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID_"],
  },
];

export function isProductionConfig(name) {
  return /^(prd|prod|production)(?:[_-]|$)/i.test(String(name ?? ""));
}

export function chooseOpenRouterSource(places) {
  for (const place of places ?? []) {
    if (place?.project === BOLT_PROJECT_NAME) continue;
    if (isProductionConfig(place?.config)) continue;
    const name = openRouterSourceNames.find((candidate) =>
      (place?.names ?? []).includes(candidate),
    );
    if (!name) continue;
    return {
      project: String(place.project),
      config: String(place.config),
      name,
    };
  }
  return null;
}

export function openRouterReferencePlan(found, root) {
  if (!found && !root) {
    return { secrets: {}, missing: [OPEN_ROUTER_API_KEY] };
  }
  return {
    secrets: {
      [OPEN_ROUTER_API_KEY]:
        root ?? referenceString(found.project, found.config, found.name),
    },
    missing: [],
  };
}

export function projectBody() {
  return {
    name: BOLT_PROJECT_NAME,
    description:
      "Bolt walkthrough. Cloudflare and OpenRouter names are references. prd stays empty.",
  };
}

export function devInheritableBody() {
  return {
    project: BOLT_PROJECT_NAME,
    config: "dev",
    inheritable: true,
  };
}

export function previewEnvironmentBody() {
  return {
    name: "Preview",
    slug: "preview",
  };
}

export function previewInheritsBody() {
  return {
    project: BOLT_PROJECT_NAME,
    config: "preview",
    inherits: [{ project: BOLT_PROJECT_NAME, config: "dev" }],
  };
}

export function prdInheritsBody() {
  return {
    project: BOLT_PROJECT_NAME,
    config: "prd",
    inherits: [],
  };
}

export function parseDopplerReference(raw) {
  if (typeof raw !== "string") return null;
  const match = raw
    .trim()
    .match(/^\$\{([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\}$/);
  if (!match) return null;
  return { project: match[1], config: match[2], name: match[3] };
}

export function referenceString(project, config, name) {
  return `\${${project}.${config}.${name}}`;
}

export function cloudflareReferencePlan(sourceNames, roots = {}) {
  const names = new Set(sourceNames ?? []);
  const secrets = {};
  const missing = [];
  for (const wanted of cloudflareSecrets) {
    const source = wanted.sources.find((name) => names.has(name));
    if (!source) {
      missing.push(wanted.dest);
      continue;
    }
    secrets[wanted.dest] =
      roots[wanted.dest] ??
      referenceString(VIBESDK_PROJECT_NAME, VIBESDK_DEV_CONFIG, source);
  }
  return { secrets, missing };
}

export function takeSecretNames(payload) {
  const secrets = payload?.secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    return [];
  }
  const names = [];
  for (const name of Object.keys(secrets)) {
    names.push(name);
    const entry = secrets[name];
    if (entry && typeof entry === "object") {
      entry.raw = undefined;
      entry.computed = undefined;
      entry.value = undefined;
    } else {
      secrets[name] = undefined;
    }
  }
  return names;
}

export function referenceResolved(value) {
  if (typeof value !== "string" || value.trim() === "") return "absent";
  if (value.trim().startsWith("${")) return "unresolved";
  return "yes";
}

export function credentialShape(value) {
  const text = String(value ?? "").trim();
  if (text.startsWith("${")) return "reference";
  if (text === "") return "absent";
  return `other length=${text.length}`;
}

export function inheritsLabel(config) {
  const value = config?.inherits;
  if (value == null || value === false || value === "") return "none";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const labels = value.map((item) => {
      if (!item || typeof item !== "object") return "";
      const project = item.project ?? "";
      const name = item.config ?? item.name ?? "";
      return project && name ? `${project}.${name}` : String(name || project);
    });
    return labels.filter(Boolean).join(",") || "none";
  }
  return "unparsed";
}

export function configReport(configs) {
  return (configs ?? [])
    .map((config) => {
      const name = String(config?.name ?? "");
      if (!name) return "";
      return `config=${name} inherits=${inheritsLabel(config)}`;
    })
    .filter(Boolean);
}

export function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-redacted")
    .slice(0, 180);
}
