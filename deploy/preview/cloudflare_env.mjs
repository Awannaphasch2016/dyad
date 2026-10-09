// Presence lines and shell exports for the preview tunnel.
// Values are written to a file. They are not printed.

import { writeFileSync } from "node:fs";
import { shellQuote } from "./render.mjs";

export const CLOUDFLARE_KEYS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
];

function filled(value) {
  return typeof value === "string" && value.length > 0;
}

export function cloudflareStatus(env, label) {
  return CLOUDFLARE_KEYS.map(
    (key) => `${label} ${key}: ${filled(env[key]) ? "present" : "absent"}`,
  ).join("\n");
}

export function dopplerCloudflareNames(download) {
  return Object.keys(download)
    .filter((name) => name.startsWith("CLOUDFLARE_"))
    .sort();
}

export function cloudflareExports(env) {
  const lines = [];
  for (const key of CLOUDFLARE_KEYS) {
    const value = env[key];
    if (!filled(value)) continue;
    if (value.includes("\n") || value.includes("\0")) {
      throw new Error(`Refusing to export ${key}`);
    }
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return lines.join("\n");
}

async function downloadDoppler(token) {
  const response = await fetch(
    "https://api.doppler.com/v3/configs/config/secrets/download?format=json",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(`Doppler download failed (${response.status})`);
  }
  return response.json();
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function main() {
  const writePath = arg("--write");
  const report = process.argv.includes("--report");
  if (!writePath && !report) return;

  if (writePath) {
    const text = cloudflareExports(process.env);
    writeFileSync(writePath, text ? `${text}\n` : "", { mode: 0o600 });
    process.stdout.write(`${cloudflareStatus(process.env, "GitHub")}\n`);
  }

  if (report) {
    const token = process.env.DOPPLER_TOKEN || "";
    const downloaded = token ? await downloadDoppler(token) : {};
    const names = dopplerCloudflareNames(downloaded);
    process.stdout.write(
      `${
        names.length
          ? `Doppler Cloudflare names: ${names.join(", ")}`
          : "Doppler Cloudflare names: none"
      }\n`,
    );
    process.stdout.write(`${cloudflareStatus(downloaded, "Doppler")}\n`);
    process.stdout.write(`${cloudflareStatus(process.env, "GitHub")}\n`);
  }
}

const isDirect =
  process.argv[1] && process.argv[1].endsWith("cloudflare_env.mjs");
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
