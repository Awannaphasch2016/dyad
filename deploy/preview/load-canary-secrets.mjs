// Read dyad/canary for the apex writer. dyad/prd is never requested.
// Names are printed. Values are written only to GITHUB_ENV.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const canaryDownload =
  "https://api.doppler.com/v3/configs/config/secrets/download?project=dyad&config=canary&format=json";

function redact(text) {
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted")
    .replace(/dp\.(?:st|pt|sa|ct|said)\.[A-Za-z0-9._-]+/g, "dp.redacted")
    .slice(0, 180);
}

export function assertCanaryDownload(url) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://api.doppler.com") {
    throw new Error("Refusing a Doppler host other than api.doppler.com");
  }
  if (parsed.pathname !== "/v3/configs/config/secrets/download") {
    throw new Error("Refusing a Doppler path other than secret download");
  }
  if (parsed.searchParams.get("project") !== "dyad") {
    throw new Error("Refusing a Doppler project other than dyad");
  }
  if (parsed.searchParams.get("config") !== "canary") {
    throw new Error("Refusing a Doppler config other than canary");
  }
}

export async function loadCanarySecrets({
  token,
  fetchImpl = fetch,
  writeEnv,
}) {
  if (!token) throw new Error("DOPPLER_ADMIN_TOKEN absent");
  assertCanaryDownload(canaryDownload);
  const response = await fetchImpl(canaryDownload, {
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
      payload = { message: redact(text) };
    }
  }
  if (!response.ok) {
    throw new Error(
      `GET canary secrets ${response.status} ${redact(payload.message || "")}`,
    );
  }
  const names = [];
  for (const [name, value] of Object.entries(payload)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== "string") continue;
    writeEnv(name, value);
    names.push(name);
  }
  return names.sort();
}

function writeGithubEnv(name, value) {
  const path = process.env.GITHUB_ENV;
  if (!path) throw new Error("GITHUB_ENV absent");
  let marker = "CANARY_SECRET_END";
  while (value.includes(marker)) marker += "_X";
  appendFileSync(path, `${name}<<${marker}\n${value}\n${marker}\n`);
  console.log(`::add-mask::${value}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  const names = await loadCanarySecrets({ token, writeEnv: writeGithubEnv });
  console.log(`canary_secret_names=${names.join(",") || "none"}`);
}
