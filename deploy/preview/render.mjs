// Shell assignments for the Devbox. Values stay quoted and are not logged.

const runtimeKeys = [
  "WEWEBPLUS_DATABASE_URL",
  "WEWEBPLUS_SECRETS_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
];

const legacyCloudflareNames = {
  CLOUDFLARE_API_TOKEN: "CLOUDFLARE_API_TOKEN_",
  CLOUDFLARE_ZONE_ID: "CLOUDFLARE_ZONE_ID_",
  CLOUDFLARE_ACCOUNT_ID: "CLOUDFLARE_ACCOUNT_ID_",
};

function pickedValue(download, key) {
  const primary = download[key];
  if (typeof primary === "string" && primary.length > 0) return primary;
  const legacyName = legacyCloudflareNames[key];
  if (legacyName) {
    const legacy = download[legacyName];
    if (typeof legacy === "string" && legacy.length > 0) return legacy;
  }
  return typeof primary === "string" ? primary : undefined;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function runtimeExports(env) {
  const lines = [];
  for (const key of runtimeKeys) {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (value.includes("\n") || value.includes("\0")) {
      throw new Error(`Refusing to export ${key}`);
    }
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return lines.join("\n");
}

export function dopplerAllowlist(download) {
  const picked = {};
  for (const key of runtimeKeys) {
    const value = pickedValue(download, key);
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

export function previewRuntime(download, childUri) {
  return runtimeExports({
    ...dopplerAllowlist(download),
    WEWEBPLUS_DATABASE_URL: childUri,
  });
}
