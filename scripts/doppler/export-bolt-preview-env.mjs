// Read bolt/preview at deploy time and pass the Cloudflare names to the job.
// Doppler stays the source of truth. Values are masked and are not printed.

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  BOLT_PROJECT_NAME,
  boltHitlSecretNames,
  boltPreviewSecretNames,
  githubEnvAssignment,
  redact,
  referenceResolved,
} from "./bolt-project.mjs";

async function downloadPreview(token) {
  const response = await fetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?project=${BOLT_PROJECT_NAME}&config=preview&format=json`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
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
      `GET bolt/preview ${response.status} ${redact(payload?.message || text)}`,
    );
  }
  return payload;
}

async function exportBoltPreviewEnv() {
  const token = process.env.DOPPLER_ADMIN_TOKEN ?? "";
  const envFile = process.env.GITHUB_ENV ?? "";
  if (!token) {
    console.log("admin_token=absent");
    process.exit(1);
  }
  if (!envFile) {
    console.log("GITHUB_ENV=absent");
    process.exit(1);
  }
  console.log("admin_token=present");
  const preview = await downloadPreview(token);
  for (const name of boltPreviewSecretNames) {
    const value = preview[name];
    const state = referenceResolved(value);
    console.log(`${name}=${state}`);
    if (state !== "yes") process.exit(1);
    console.log(`::add-mask::${value}`);
    appendFileSync(envFile, githubEnvAssignment(name, value));
  }
  for (const name of boltHitlSecretNames) {
    const value = preview[name];
    const state = referenceResolved(value);
    console.log(`hitl_${name}=${state}`);
    if (state !== "yes") continue;
    console.log(`::add-mask::${value}`);
    appendFileSync(envFile, githubEnvAssignment(name, value));
    preview[name] = undefined;
  }
  console.log("bolt_preview_export=ok");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  exportBoltPreviewEnv().catch((error) => {
    console.log(redact(error?.message || error));
    process.exit(1);
  });
}
