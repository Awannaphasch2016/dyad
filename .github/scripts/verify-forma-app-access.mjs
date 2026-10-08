#!/usr/bin/env node
// Read-only check for the dyad-harness installation.
// The workflow asks for contents, packages, pull requests, and workflows
// write on forma, bolt.diy, and vibesdk. Token creation fails when any of
// those grants is missing. This script then only sends GET requests.

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REPOS = ["forma", "bolt.diy", "vibesdk"];
export const IMAGE_TAG = "sha-80a8e419f6285378b4dfada336ea8213f3089bab";

export function redact(text) {
  return String(text ?? "")
    .replace(/ghs_[A-Za-z0-9_]+/g, "ghs_REDACTED")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_REDACTED")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_REDACTED")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED")
    .replace(/"(token|access_token)"\s*:\s*"[^"]+"/g, '"$1":"redacted"');
}

async function expectOk(response, label) {
  if (response.ok) return;
  throw new Error(`${label} ${response.status}`);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "dyad-preview-forma",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const manifestAccept = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

function basic(username, token) {
  return `Basic ${Buffer.from(`${username}:${token}`, "utf8").toString("base64")}`;
}

function digestFrom(response) {
  return response.headers.get("docker-content-digest") || "absent";
}

export async function readImageDigest({ token, fetchImpl, tag = IMAGE_TAG }) {
  const manifestUrl = `https://ghcr.io/v2/awannaphasch2016/forma/manifests/${tag}`;
  const attempts = [];
  const direct = await fetchImpl(manifestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: manifestAccept,
    },
  });
  if (direct.ok) return { auth: "bearer", digest: digestFrom(direct) };
  attempts.push(`bearer=${direct.status}`);

  const basicManifest = await fetchImpl(manifestUrl, {
    headers: {
      Authorization: basic("x-access-token", token),
      Accept: manifestAccept,
    },
  });
  if (basicManifest.ok) {
    return { auth: "basic", digest: digestFrom(basicManifest) };
  }
  attempts.push(`basic=${basicManifest.status}`);

  for (const username of ["x-access-token", "dyad-harness[bot]"]) {
    const registry = await fetchImpl(
      "https://ghcr.io/token?service=ghcr.io&scope=repository:awannaphasch2016/forma:pull",
      { headers: { Authorization: basic(username, token) } },
    );
    if (!registry.ok) {
      attempts.push(`token_${username}=${registry.status}`);
      continue;
    }
    const registryBody = await registry.json();
    if (!registryBody.token) {
      attempts.push(`token_${username}=missing`);
      continue;
    }
    const manifest = await fetchImpl(manifestUrl, {
      headers: {
        Authorization: `Bearer ${registryBody.token}`,
        Accept: manifestAccept,
      },
    });
    if (manifest.ok) {
      return { auth: username, digest: digestFrom(manifest) };
    }
    attempts.push(`manifest_${username}=${manifest.status}`);
  }
  throw new Error(`forma_packages=denied ${attempts.join(" ")}`);
}

export async function verifyFormaAppAccess({
  token,
  fetchImpl = fetch,
  log = () => {},
}) {
  const lines = [];
  const push = (line) => {
    lines.push(line);
    log(line);
  };
  for (const repo of REPOS) {
    const response = await fetchImpl(
      `https://api.github.com/repos/Awannaphasch2016/${repo}`,
      { headers: githubHeaders(token) },
    );
    await expectOk(response, `repo ${repo}`);
    const body = await response.json();
    push(`repo ${repo}=ok private=${Boolean(body.private)}`);
  }

  const dockerfile = await fetchImpl(
    "https://api.github.com/repos/Awannaphasch2016/forma/contents/Dockerfile?ref=main",
    { headers: githubHeaders(token) },
  );
  await expectOk(dockerfile, "forma_contents");
  const dockerfileBody = await dockerfile.json();
  push(`forma_contents=ok bytes=${Number(dockerfileBody.size) || 0}`);

  const pulls = await fetchImpl(
    "https://api.github.com/repos/Awannaphasch2016/forma/pulls?state=all&per_page=1",
    { headers: githubHeaders(token) },
  );
  await expectOk(pulls, "forma_pulls");
  push("forma_pulls=ok");

  const image = await readImageDigest({ token, fetchImpl });
  push(`forma_packages=ok auth=${image.auth} digest=${image.digest}`);
  return lines;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const token = process.env.GH_TOKEN ?? "";
  if (!token) {
    console.log("GH_TOKEN=absent");
    process.exit(1);
  }
  const log = (line) => writeSync(1, `${line}\n`);
  log(
    "app_token=created repos=forma,bolt.diy,vibesdk permissions=contents:write,packages:write,pull-requests:write,workflows:write",
  );
  verifyFormaAppAccess({ token, log }).catch((error) => {
    log(redact(error?.message || String(error)));
    process.exit(1);
  });
}
