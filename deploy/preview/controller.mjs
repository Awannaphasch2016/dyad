#!/usr/bin/env node
// Attach or delete the Neon branch for one preview. Prints the host, never the URI.

import { writeFileSync } from "node:fs";
import { commandForPullRequest } from "./transition.mjs";
import { deletePreviewBranch, ensurePreviewBranch } from "./neon.mjs";
import {
  credentialsFromEnvironment,
  mergeAwsCredentials,
  previewRuntime,
  withEnvironmentSecrets,
} from "./render.mjs";
import {
  assignmentLog,
  assignPreviewDatabase,
  assignPreviewVariable,
  deletePreviewDatabase,
  deletePreviewVariable,
  previewGasCityKey,
  previewGasCityOrigin,
  redeployPreviewBranch,
} from "./vercel.mjs";

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
  let downloaded = {};
  if (token) {
    downloaded = await downloadDoppler(token);
    if (!process.env.NEON_API_KEY && downloaded.NEON_API_KEY) {
      process.env.NEON_API_KEY = downloaded.NEON_API_KEY;
    }
  }
  const awsToken = process.env.AWS_DOPPLER_TOKEN || "";
  const awsDownload = awsToken ? await downloadDoppler(awsToken) : {};
  return credentialsFromEnvironment(
    mergeAwsCredentials(downloaded, awsDownload, process.env),
    process.env,
  );
}

async function attach(pr) {
  const out = arg("--out") || "/tmp/preview-runtime.sh";
  const downloaded = withEnvironmentSecrets(await runtimeEnv(), process.env);
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
  const cloudflareNames = [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ZONE_ID",
    "CLOUDFLARE_ACCOUNT_ID",
  ];
  console.log(
    cloudflareNames
      .map(
        (name) =>
          `${name}: ${exports.includes(`export ${name}=`) ? "present" : "absent"}`,
      )
      .join(", "),
  );
  console.log(`Attached ${branch.name} at ${branch.host}`);
  const assigned = await assignVercelDatabase(pr, branch);
  if (assigned) await redeployAssigned(assigned);
}

async function assignVercelDatabase(pr, branch) {
  const gitBranch = arg("--git-branch");
  if (!gitBranch) return null;
  const token = process.env.VERCEL_TOKEN || "";
  if (!token) {
    console.log(
      "Vercel preview database was not assigned. VERCEL_TOKEN is not set.",
    );
    return null;
  }
  const assigned = await assignPreviewDatabase({
    token,
    project: arg("--vercel-project") || undefined,
    gitBranch,
    uri: branch.uri,
  });
  console.log(
    assignmentLog({
      ...assigned,
      pr,
      neonBranch: branch.name,
    }),
  );
  const origin = previewGasCityOrigin(pr);
  const page = await assignPreviewVariable({
    token,
    project: arg("--vercel-project") || undefined,
    gitBranch,
    key: previewGasCityKey,
    value: origin,
  });
  console.log(
    `Assigned ${page.key} for pull request ${pr} git branch ${page.gitBranch} to ${origin} on Vercel project ${page.project} target ${page.targets}`,
  );
  return assigned;
}

async function redeployAssigned(assigned) {
  try {
    const rolled = await redeployPreviewBranch({
      token: process.env.VERCEL_TOKEN,
      project: assigned.project,
      projectId: assigned.projectId,
      teamId: assigned.teamId,
      gitBranch: assigned.gitBranch,
    });
    console.log(
      rolled.redeployed
        ? `Redeployed Vercel preview ${rolled.url} for ${rolled.gitBranch}`
        : `No Vercel deployment to redeploy for ${rolled.gitBranch}`,
    );
  } catch (error) {
    console.log(
      `Vercel redeploy failed after the database assignment: ${error.message}`,
    );
  }
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
  const gitBranch = arg("--git-branch");
  const token = process.env.VERCEL_TOKEN || "";
  if (!gitBranch || !token) return;
  const removed = await deletePreviewDatabase({
    token,
    project: arg("--vercel-project") || undefined,
    gitBranch,
  });
  console.log(
    removed.deleted
      ? `Removed Vercel preview database for ${removed.gitBranch}`
      : `Vercel preview database for ${removed.gitBranch} was already gone`,
  );
  const gasCity = await deletePreviewVariable({
    token,
    project: arg("--vercel-project") || undefined,
    gitBranch,
    key: previewGasCityKey,
  });
  console.log(
    gasCity.deleted
      ? `Removed ${gasCity.key} for ${gasCity.gitBranch}`
      : `${previewGasCityKey} for ${gasCity.gitBranch} was already gone`,
  );
}

async function assignVercel(pr) {
  const apiKey = process.env.NEON_API_KEY || "";
  if (!apiKey) {
    throw new Error("NEON_API_KEY is not set");
  }
  if (!process.env.VERCEL_TOKEN) {
    throw new Error("VERCEL_TOKEN is not set");
  }
  if (!arg("--git-branch")) {
    throw new Error("A non-production git branch is required");
  }
  const branch = await ensurePreviewBranch({ apiKey, pr });
  console.log(`Attached ${branch.name} at ${branch.host}`);
  const assigned = await assignVercelDatabase(pr, branch);
  if (!assigned) {
    throw new Error("Vercel preview database was not assigned");
  }
  await redeployAssigned(assigned);
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
} else if (
  command === "attach" ||
  command === "assign-vercel" ||
  command === "assign-page"
) {
  if (command === "assign-vercel" || command === "assign-page") {
    await assignVercel(pr);
  } else await attach(pr);
} else if (command === "destroy") {
  await destroy(pr);
} else {
  console.error("Unknown command");
  process.exit(2);
}
