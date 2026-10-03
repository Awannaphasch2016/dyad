#!/usr/bin/env node
// Attach or delete the Neon branch for one preview. Prints the host, never the URI.

import { writeFileSync } from "node:fs";
import { commandForPullRequest } from "./transition.mjs";
import { deletePreviewBranch, ensurePreviewBranch } from "./neon.mjs";
import { previewRuntime } from "./render.mjs";

const dopplerDownloadUrl =
  "https://api.doppler.com/v3/configs/config/secrets/download?format=json";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function downloadDoppler(token) {
  const response = await fetch(dopplerDownloadUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Doppler download failed (${response.status})`);
  }
  return response.json();
}

async function runtimeEnv() {
  const token = process.env.DOPPLER_TOKEN || "";
  if (token) {
    const downloaded = await downloadDoppler(token);
    if (!process.env.NEON_API_KEY && downloaded.NEON_API_KEY) {
      process.env.NEON_API_KEY = downloaded.NEON_API_KEY;
    }
    return downloaded;
  }
  return {};
}

async function attach(pr) {
  const out = arg("--out") || "/tmp/preview-runtime.sh";
  const downloaded = await runtimeEnv();
  const apiKey = process.env.NEON_API_KEY || "";
  if (!apiKey) {
    writeFileSync(out, "", { mode: 0o600 });
    console.log(
      "Neon preview branch was not attached. Add the DOPPLER_TOKEN GitHub secret for the dyad preview config.",
    );
    return;
  }
  const branch = await ensurePreviewBranch({ apiKey, pr });
  const exports = previewRuntime(downloaded, branch.uri);
  writeFileSync(out, exports ? `${exports}\n` : "", { mode: 0o600 });
  console.log(`Attached ${branch.name} at ${branch.host}`);
}

async function destroy(pr) {
  if (!process.env.NEON_API_KEY && process.env.DOPPLER_TOKEN) {
    await runtimeEnv();
  }
  if (!process.env.NEON_API_KEY) {
    console.log("Neon branch was not deleted. DOPPLER_TOKEN is not set.");
    return;
  }
  const result = await deletePreviewBranch({
    apiKey: process.env.NEON_API_KEY,
    pr,
  });
  console.log(
    result.deleted
      ? `Deleted ${result.name}`
      : `${result.name} was already gone`,
  );
}

async function decide() {
  const labels = (arg("--labels") || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const command = commandForPullRequest({
    action: arg("--action"),
    label: arg("--label"),
    labels,
    closed: arg("--closed") === "true",
  });
  console.log(command);
}

const command = process.argv[2];
const pr = arg("--pr");

if (command === "decide") {
  await decide();
} else if (!/^[0-9]+$/.test(pr)) {
  console.error("Usage: controller.mjs <attach|destroy|decide> --pr <number>");
  process.exit(2);
} else if (command === "attach") {
  await attach(pr);
} else if (command === "destroy") {
  await destroy(pr);
} else {
  console.error("Unknown command");
  process.exit(2);
}
