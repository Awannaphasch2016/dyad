#!/usr/bin/env node
// Make ghcr.io/awannaphasch2016/forma public. Prints statuses only.

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

const owner = "Awannaphasch2016";
const repo = "forma";
const branch = "cursor/forma-image-public-5014";
const workflowPath = ".github/workflows/make-forma-package-public.yml";
const imageTag = "sha-80a8e419f6285378b4dfada336ea8213f3089bab";

export const formaWorkflow = `name: Make Forma package public

on:
  push:
    branches:
      - ${branch}

permissions:
  contents: read
  packages: write

jobs:
  public:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Set the package visibility
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          set +x
          node --input-type=module <<'NODE'
          const endpoints = [
            "/users/${owner}/packages/container/forma",
            "/user/packages/container/forma",
          ];
          let published = false;
          for (const path of endpoints) {
            const response = await fetch("https://api.github.com" + path, {
              method: "PATCH",
              headers: {
                Authorization: "Bearer " + process.env.GH_TOKEN,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "dyad-preview-forma",
                "X-GitHub-Api-Version": "2022-11-28",
              },
              body: JSON.stringify({ visibility: "public" }),
            });
            let visibility = "";
            if (response.ok) {
              const body = await response.json().catch(() => ({}));
              visibility = body.visibility || "";
            }
            console.log("forma_package_api " + path + " " + response.status + (visibility ? " " + visibility : ""));
            if (visibility === "public") published = true;
          }
          if (!published) process.exit(1);
          NODE
`;

export function redact(text) {
  return String(text ?? "")
    .replace(/ghs_[A-Za-z0-9_]+/g, "ghs_REDACTED")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_REDACTED")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED");
}

function githubHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "dyad-preview-forma",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

export async function setPackagePublic({ token, fetchImpl }) {
  const attempts = [];
  for (const path of [
    `/users/${owner}/packages/container/forma`,
    "/user/packages/container/forma",
  ]) {
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method: "PATCH",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ visibility: "public" }),
    });
    let visibility = "";
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      visibility = body.visibility || "";
    }
    attempts.push(
      `${path}=${response.status}${visibility ? ` ${visibility}` : ""}`,
    );
    if (visibility === "public") return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

export async function anonymousImageVisible(fetchImpl) {
  const tokenResponse = await fetchImpl(
    "https://ghcr.io/token?service=ghcr.io&scope=repository:awannaphasch2016/forma:pull",
  );
  if (!tokenResponse.ok) return false;
  const tokenBody = await tokenResponse.json();
  const payload = String(tokenBody.token ?? "").split(".")[1] ?? "";
  if (!payload) return false;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const access = Array.isArray(claims.access) ? claims.access : [];
  const canPull = access.some(
    (entry) =>
      entry.name === "awannaphasch2016/forma" &&
      Array.isArray(entry.actions) &&
      entry.actions.includes("pull"),
  );
  if (!canPull) return false;
  const manifest = await fetchImpl(
    `https://ghcr.io/v2/awannaphasch2016/forma/manifests/${imageTag}`,
    {
      headers: {
        Authorization: `Bearer ${tokenBody.token}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
    },
  );
  return manifest.ok;
}

export async function pushFormaWorkflow({ token, fetchImpl }) {
  const main = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`,
    { headers: githubHeaders(token) },
  );
  if (!main.ok) throw new Error(`forma_main ${main.status}`);
  const mainBody = await main.json();
  const sha = mainBody.object?.sha;
  if (!sha) throw new Error("forma_main missing sha");

  const existing = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: githubHeaders(token) },
  );
  if (existing.status === 404) {
    const created = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: "POST",
        headers: githubHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      },
    );
    if (!created.ok) throw new Error(`forma_branch ${created.status}`);
  } else if (!existing.ok) {
    throw new Error(`forma_branch_lookup ${existing.status}`);
  }

  const current = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}?ref=${branch}`,
    { headers: githubHeaders(token) },
  );
  const currentSha = current.ok ? (await current.json()).sha : undefined;
  const saved = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
    {
      method: "PUT",
      headers: githubHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: "Make the Forma container package public",
        content: Buffer.from(formaWorkflow, "utf8").toString("base64"),
        branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    },
  );
  if (!saved.ok) throw new Error(`forma_workflow ${saved.status}`);
  return branch;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function makeFormaPackagePublic({
  token,
  fetchImpl = fetch,
  log = console.log,
  pause = delay,
  attempts = 18,
}) {
  const direct = await setPackagePublic({ token, fetchImpl });
  log(`forma_package_api ${direct.attempts.join(" ")}`);
  let via = direct.ok ? "app" : "";
  if (!via) {
    const pushed = await pushFormaWorkflow({ token, fetchImpl });
    log(`forma_workflow=pushed ${pushed}`);
    via = "workflow";
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (await anonymousImageVisible(fetchImpl)) {
      log(`forma_package=public via=${via}`);
      return via;
    }
    if (attempt < attempts) await pause(10000);
  }
  throw new Error("forma_package=still_private");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const token = process.env.GH_TOKEN ?? "";
  const log = (line) => writeSync(1, `${redact(line)}\n`);
  if (!token) {
    log("GH_TOKEN=absent");
    process.exit(1);
  }
  makeFormaPackagePublic({ token, log }).catch((error) => {
    log(redact(error?.message || String(error)));
    process.exit(1);
  });
}
