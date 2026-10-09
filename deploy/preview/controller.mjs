#!/usr/bin/env node
// Attach or delete the Neon branch for one preview. Prints the host, never the URI.

import { writeFileSync } from "node:fs";
import { commandForPullRequest } from "./transition.mjs";
import { deletePreviewBranch, ensurePreviewBranch } from "./neon.mjs";
import { previewRuntime } from "./render.mjs";
import { cloudflareStatus, dopplerCloudflareNames } from "./cloudflare_env.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

async function downloadDoppler(token, project = "", config = "") {
  const params = new URLSearchParams({ format: "json" });
  if (project) params.set("project", project);
  if (config) params.set("config", config);
  const response = await fetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?${params}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    const where = project ? ` project=${project} config=${config}` : "";
    throw new Error(`Doppler download failed (${response.status})${where}`);
  }
  return response.json();
}

async function runtimeEnv() {
  const token = process.env.DOPPLER_TOKEN || "";
  const admin = process.env.DOPPLER_ADMIN_TOKEN || "";
  let downloaded = {};
  if (token) {
    downloaded = await downloadDoppler(token);
  } else if (admin) {
    console.log("doppler admin token present");
    downloaded = await downloadDoppler(admin, "dyad", "preview");
  } else {
    console.log("doppler token absent");
    return {};
  }
  if (!process.env.NEON_API_KEY && downloaded.NEON_API_KEY) {
    process.env.NEON_API_KEY = downloaded.NEON_API_KEY;
  }
  const names = dopplerCloudflareNames(downloaded);
  console.log(
    names.length
      ? `Doppler Cloudflare names: ${names.join(", ")}`
      : "Doppler Cloudflare names: none",
  );
  console.log(cloudflareStatus(downloaded, "Doppler"));
  return downloaded;
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
