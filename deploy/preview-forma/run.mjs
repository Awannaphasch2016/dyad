#!/usr/bin/env node
// Decide, check pins, or skip cleanup. No Doppler, Neon, or Docker call.

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { commandForFormaPreview } from "./command.mjs";
import { manifestUrl, pinnedImages, readPinnedImages } from "./compose.mjs";
import { assertPreviewHost } from "./host.mjs";
import {
  assertDockerHost,
  assertFormaPreviewTarget,
  FORMA_NEON_PROJECT_ID,
  FORMA_PARENT_BRANCH_ID,
  formaPreviewBranchName,
} from "./target.mjs";

const manifestAccept = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export function decideFromEnv(env = process.env) {
  const pr = String(env.PR ?? "").trim();
  if (env.EVENT === "workflow_dispatch") {
    if (!/^[0-9]+$/.test(pr)) {
      throw new Error("Pull request number must be digits");
    }
    return { command: "update", pr };
  }
  const labels = String(env.LABELS ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return {
    command: commandForFormaPreview({
      action: env.ACTION,
      label: env.LABEL,
      labels,
      closed: String(env.CLOSED ?? "") === "true",
    }),
    pr,
  };
}

function writeOutput(result) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  appendFileSync(path, `command=${result.command}\npr=${result.pr}\n`);
}

export function registryTokenUrl(image) {
  const [found] = pinnedImages({ services: { check: { image } } });
  const params = new URLSearchParams({
    service: "ghcr.io",
    scope: `repository:awannaphasch2016/${found.repository}:pull`,
  });
  return `https://ghcr.io/token?${params}`;
}

async function registryPullToken(image, githubToken, fetchImpl) {
  const tokenUrl = registryTokenUrl(image);
  const request = async (authorization) =>
    fetchImpl(tokenUrl, {
      headers: {
        Accept: "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
  let response = await request(githubToken ? `Bearer ${githubToken}` : "");
  if ((response.status === 401 || response.status === 403) && githubToken) {
    response = await request("");
  }
  if (!response.ok) throw new Error(`GHCR denied ${image}`);
  const body = await response.json().catch(() => ({}));
  const pullToken = body.token || body.access_token || "";
  if (!pullToken) throw new Error(`GHCR denied ${image}`);
  return pullToken;
}

export async function resolveManifest(image, token, fetchImpl = fetch) {
  const pullToken = await registryPullToken(image, token, fetchImpl);
  const response = await fetchImpl(manifestUrl(image), {
    headers: {
      Accept: manifestAccept,
      Authorization: `Bearer ${pullToken}`,
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`GHCR denied ${image}`);
  }
  if (!response.ok) {
    throw new Error(`GHCR ${response.status} for ${image}`);
  }
  const digest = response.headers.get("docker-content-digest") || "";
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`GHCR did not return a digest for ${image}`);
  }
  return digest;
}

export async function checkCompose(env = process.env) {
  const composePath = env.COMPOSE || "deploy/preview-forma/compose.yml";
  const images = await readPinnedImages(composePath);
  for (const item of images) {
    console.log(`preview_forma_image=${item.service} ${item.image}`);
  }
  const token = String(env.GH_TOKEN ?? "").trim();
  if (!token) {
    console.log("preview_forma_token=absent");
  } else {
    for (const item of images) {
      const digest = await resolveManifest(item.image, token);
      console.log(`preview_forma_digest=${item.service} ${digest}`);
    }
  }
  const override = String(env.PREVIEW_FORMA_DOCKER_HOST ?? "").trim();
  if (override) assertDockerHost(override);
  const hostPath = env.HOST || "deploy/preview-forma/host.json";
  const host = assertPreviewHost(JSON.parse(readFileSync(hostPath, "utf8")));
  console.log(`preview_forma_host=${host.albDns}`);
  console.log("preview_forma_task=not_started");
}

export function planDown(env = process.env) {
  const target = assertFormaPreviewTarget({
    projectId: FORMA_NEON_PROJECT_ID,
    parentId: FORMA_PARENT_BRANCH_ID,
    branchName: formaPreviewBranchName(env.PR),
  });
  const override = String(env.PREVIEW_FORMA_DOCKER_HOST ?? "").trim();
  if (override) assertDockerHost(override);
  console.log("preview_forma_down=skipped task=not_started");
  return { action: "skip", ...target };
}

async function main() {
  const mode = process.argv[2];
  if (mode === "decide") {
    const result = decideFromEnv();
    writeOutput(result);
    console.log(`preview_forma_command=${result.command}`);
    console.log(`preview_forma_pr=${result.pr}`);
    return;
  }
  if (mode === "check") {
    await checkCompose();
    return;
  }
  if (mode === "down") {
    planDown();
    return;
  }
  throw new Error("Usage: run.mjs decide|check|down");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    console.log(error?.message || String(error));
    process.exit(1);
  });
}
