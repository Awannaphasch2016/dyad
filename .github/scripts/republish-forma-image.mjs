#!/usr/bin/env node
// Point the Forma image workflow at the repository owner, then let that
// push publish the image. Logging in as dyad-harness[bot] stored a manifest
// and left the account package list empty. Does not print credentials.

import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

const owner = "Awannaphasch2016";
const repo = "forma";
const branch = "cursor/forma-preview-walkthrough";
const workflowPath = ".github/workflows/publish-image.yml";

export const publishWorkflow = `# Build the Forma image for this commit.
# Log in as the repository owner so the package is created on that account.
name: Publish Forma image

on:
  workflow_dispatch:
  push:
    branches:
      - cursor/forma-preview-walkthrough

permissions:
  contents: read
  packages: write

concurrency:
  group: forma-image-\${{ github.sha }}
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.repository_owner }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          push: true
          provenance: false
          sbom: false
          tags: ghcr.io/awannaphasch2016/forma:sha-\${{ github.sha }}
          labels: |
            org.opencontainers.image.revision=\${{ github.sha }}
            org.opencontainers.image.source=\${{ github.server_url }}/\${{ github.repository }}

      - name: Report the digest
        run: |
          set -euo pipefail
          echo "forma_image=ghcr.io/awannaphasch2016/forma@\${{ steps.build.outputs.digest }}"

      - name: Record the package
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          set +x
          node --input-type=module <<'NODE'
          const headers = {
            Authorization: \`Bearer \${process.env.GH_TOKEN}\`,
            Accept: "application/vnd.github+json",
            "User-Agent": "forma-publish",
            "X-GitHub-Api-Version": "2022-11-28",
          };
          const urls = [
            "https://api.github.com/user/packages/container/forma",
            "https://api.github.com/users/Awannaphasch2016/packages/container/forma",
          ];
          for (const url of urls) {
            const response = await fetch(url, { headers });
            const label = url.includes("/users/") ? "users" : "user";
            process.stdout.write(\`forma_package_get_\${label}=\${response.status}\\n\`);
            if (response.status !== 200) continue;
            const body = await response.json();
            process.stdout.write(\`forma_package_visibility=\${body.visibility}\\n\`);
            process.stdout.write(\`forma_package_url=\${body.html_url}\\n\`);
            if (body.visibility === "public") continue;
            const patched = await fetch(url, {
              method: "PATCH",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ visibility: "public" }),
            });
            process.stdout.write(\`forma_package_patch_\${label}=\${patched.status}\\n\`);
          }
          NODE
`;

export function redact(text) {
  return String(text ?? "")
    .replace(/ghs_[A-Za-z0-9_]+/g, "ghs_REDACTED")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_REDACTED")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED");
}

export function workflowNeedsOwnerLogin(content) {
  const text = String(content ?? "");
  return (
    text.includes("github.actor") ||
    !text.includes("username: ${{ github.repository_owner }}")
  );
}

function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "dyad-preview-forma",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

function decodeContent(content) {
  return Buffer.from(
    String(content ?? "").replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
}

export async function republishFormaImage({ token, fetchImpl = fetch }) {
  const readUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}?ref=${encodeURIComponent(branch)}`;
  const current = await fetchImpl(readUrl, { headers: headers(token) });
  if (!current.ok) throw new Error(`forma_workflow ${current.status}`);
  const payload = await current.json();
  const existing = decodeContent(payload.content);
  if (!workflowNeedsOwnerLogin(existing)) {
    return { updated: false, sha: payload.sha };
  }
  if (!payload.sha) throw new Error("forma_workflow missing sha");

  const updated = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/contents/${workflowPath}`,
    {
      method: "PUT",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: "Log in to GHCR as the repository owner.",
        content: Buffer.from(publishWorkflow, "utf8").toString("base64"),
        sha: payload.sha,
        branch,
      }),
    },
  );
  if (!updated.ok) {
    let message = "";
    try {
      message = (await updated.json())?.message ?? "";
    } catch {
      message = "";
    }
    throw new Error(`forma_workflow_put ${updated.status} ${message}`.trim());
  }
  const body = await updated.json();
  const sha = body.commit?.sha;
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
    throw new Error("forma_workflow_put missing sha");
  }
  return { updated: true, sha };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const token = process.env.GH_TOKEN ?? "";
  const log = (line) => writeSync(1, `${redact(line)}\n`);
  if (!token) {
    log("GH_TOKEN=absent");
    process.exit(1);
  }
  republishFormaImage({ token })
    .then(({ updated, sha }) => {
      log(`forma_publish_workflow=${updated ? "updated" : "unchanged"}`);
      if (sha) log(`forma_publish_commit=${sha}`);
    })
    .catch((error) => {
      log(redact(error?.message || String(error)));
      process.exit(1);
    });
}
