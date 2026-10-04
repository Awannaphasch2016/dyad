// Shell assignments for the Devbox. Values stay quoted and are not logged.

const runtimeKeys = [
  "WEWEBPLUS_DATABASE_URL",
  "WEWEBPLUS_SECRETS_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "CLOUDFLARE_API_TOKEN_",
  "CLOUDFLARE_ZONE_ID_",
  "CLOUDFLARE_ACCOUNT_ID",
];

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
    if (typeof download[key] === "string") picked[key] = download[key];
  }
  return picked;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

// Fill only the three Bedrock IAM names. A later source does not replace a
// value that is already present. The region falls back to AWS_DEFAULT_REGION,
// then ap-southeast-1, only when both keys are set.
export function mergeAwsCredentials(download, extra, env) {
  const merged = { ...download };
  const fill = (key, value) => {
    if (nonEmpty(merged[key])) return;
    const next = nonEmpty(value);
    if (next) merged[key] = next;
  };
  for (const source of [extra || {}, env || {}]) {
    fill("AWS_ACCESS_KEY_ID", source.AWS_ACCESS_KEY_ID);
    fill("AWS_SECRET_ACCESS_KEY", source.AWS_SECRET_ACCESS_KEY);
    fill("AWS_REGION", source.AWS_REGION);
  }
  if (
    !nonEmpty(merged.AWS_REGION) &&
    nonEmpty(merged.AWS_ACCESS_KEY_ID) &&
    nonEmpty(merged.AWS_SECRET_ACCESS_KEY)
  ) {
    merged.AWS_REGION = nonEmpty(env?.AWS_DEFAULT_REGION) || "ap-southeast-1";
  }
  return merged;
}

export function previewRuntime(download, childUri) {
  return runtimeExports({
    ...dopplerAllowlist(download),
    WEWEBPLUS_DATABASE_URL: childUri,
  });
}
