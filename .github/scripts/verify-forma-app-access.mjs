#!/usr/bin/env node
// Read-only check for the dyad-harness installation.
// Run 37843149097 created a token for contents, packages, pull requests,
// and workflows write on forma, bolt.diy, and vibesdk. Repository, file,
// and pull request reads succeeded. The GHCR manifest stayed forbidden and
// the registry access list was empty. The push-triggered workflow was
// removed after that run. Do not add it back as a standing secret job.

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

export function registryAccess(registryToken) {
  const payload = String(registryToken ?? "").split(".")[1] ?? "";
  if (!payload) return "none";
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const access = Array.isArray(json.access) ? json.access : [];
    if (access.length === 0) return "none";
    return access
      .map((entry) => {
        const actions = Array.isArray(entry.actions) ? entry.actions : [];
        return `${entry.name}:${actions.join("+") || "none"}`;
      })
      .join(",");
  } catch {
    return "unreadable";
  }
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
    attempts.push(`access_${username}=${registryAccess(registryBody.token)}`);
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
    const tags = await fetchImpl(
      "https://ghcr.io/v2/awannaphasch2016/forma/tags/list",
      { headers: { Authorization: `Bearer ${registryBody.token}` } },
    );
    attempts.push(`tags_${username}=${tags.status}`);
  }
  throw new Error(`forma_packages=denied ${attempts.join(" ")}`);
}

async function packageSummary(response) {
  if (!response.ok) return String(response.status);
  const packages = await response.json();
  if (!Array.isArray(packages)) return "not_array";
  return (
    packages
      .map((pkg) => `${pkg.name}:${pkg.visibility || "unknown"}`)
      .join(",") || "none"
  );
}

export async function describeFormaPackage({ token, fetchImpl }) {
  const headers = githubHeaders(token);
  const repoList = await fetchImpl(
    "https://api.github.com/repos/Awannaphasch2016/forma/packages?package_type=container",
    { headers },
  );
  const userList = await fetchImpl(
    "https://api.github.com/users/Awannaphasch2016/packages?package_type=container",
    { headers },
  );
  const one = await fetchImpl(
    "https://api.github.com/users/Awannaphasch2016/packages/container/forma",
    { headers },
  );
  let detail = String(one.status);
  if (one.ok) {
    const body = await one.json();
    detail = `${body.visibility || "unknown"} repo=${body.repository?.full_name || "unlinked"}`;
  }
  return `forma_package_list=${await packageSummary(repoList)} user_packages=${await packageSummary(userList)} forma_package=${detail}`;
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
  push(await describeFormaPackage({ token, fetchImpl }));

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
