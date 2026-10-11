import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMA_REPOSITORY = "Awannaphasch2016/forma";
export const FORMA_BASE_BRANCH = "main";
export const FORMA_IMAGE_BRANCH = "cursor/forma-hitl-image-5014";
export const BOT_NAME = "dyad-harness[bot]";
export const BOT_EMAIL = "5221649+dyad-harness[bot]@users.noreply.github.com";

export function imageWorkflow() {
  return `# Build the Forma image for the role-pause commit.
# Log in as the repository owner so the package stays on that account.
name: Publish Forma image

on:
  push:
    branches:
      - ${FORMA_IMAGE_BRANCH}

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
`;
}

export function assertImageWorkflow(text) {
  const value = String(text);
  if (!value.includes(`- ${FORMA_IMAGE_BRANCH}`)) {
    throw new Error("Image workflow is not limited to the HITL image branch");
  }
  if (value.includes("cursor/forma-preview-walkthrough")) {
    throw new Error("Image workflow must not publish the walkthrough branch");
  }
  if (!value.includes("username: ${{ github.repository_owner }}")) {
    throw new Error("Image workflow must log in as the repository owner");
  }
  if (value.includes("github.actor")) {
    throw new Error("Image workflow must not log in as the pushing actor");
  }
}

export function credentialHelperSource() {
  return `#!/bin/sh
case "$1" in
  get)
    printf '%s\\n' "username=x-access-token" "password=$GH_TOKEN"
    ;;
esac
`;
}

export function gitCredentialEnv(baseEnv, helperPath) {
  return {
    ...baseEnv,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: `!${helperPath}`,
  };
}

export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(
      /https:\/\/x-access-token:[^@\s]+@/g,
      "https://x-access-token:[redacted]@",
    );
}

function runOrThrow(command, args, options, secrets) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    const stdout = error.stdout?.toString?.() ?? "";
    throw new Error(redact(`${error.message}\n${stdout}\n${stderr}`, secrets));
  }
}

export function publishFormaHitlImage({
  env = process.env,
  workRoot = tmpdir(),
} = {}) {
  const token = env.GH_TOKEN || "";
  if (!token) throw new Error("GH_TOKEN is missing.");
  const secrets = [token];
  const workflow = imageWorkflow();
  assertImageWorkflow(workflow);
  const helperPath = path.join(workRoot, "forma-git-ask.sh");
  writeFileSync(helperPath, credentialHelperSource(), { mode: 0o700 });
  const gitEnv = gitCredentialEnv(env, helperPath);
  const clone = path.join(workRoot, "forma-image");
  runOrThrow(
    "git",
    [
      "-c",
      "credential.helper=",
      "clone",
      "--depth",
      "1",
      "--branch",
      FORMA_BASE_BRANCH,
      `https://github.com/${FORMA_REPOSITORY}.git`,
      clone,
    ],
    { env: gitEnv },
    secrets,
  );
  const workflowPath = path.join(clone, ".github/workflows/publish-image.yml");
  writeFileSync(workflowPath, workflow);
  runOrThrow(
    "git",
    ["add", ".github/workflows/publish-image.yml"],
    {
      cwd: clone,
    },
    secrets,
  );
  runOrThrow("git", ["config", "user.name", BOT_NAME], { cwd: clone }, secrets);
  runOrThrow(
    "git",
    ["config", "user.email", BOT_EMAIL],
    { cwd: clone },
    secrets,
  );
  runOrThrow(
    "git",
    [
      "commit",
      "-m",
      "Publish the Forma role-pause image.\n\nThe package is pushed as the repository owner.\n",
    ],
    { cwd: clone, env: gitEnv },
    secrets,
  );
  const sha = runOrThrow(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: clone },
    secrets,
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error("Image commit sha is missing");
  runOrThrow(
    "git",
    [
      "push",
      `https://github.com/${FORMA_REPOSITORY}.git`,
      `HEAD:refs/heads/${FORMA_IMAGE_BRANCH}`,
    ],
    { cwd: clone, env: gitEnv },
    secrets,
  );
  console.log(`forma_image_sha=${sha}`);
  console.log(`forma_image_ref=ghcr.io/awannaphasch2016/forma:sha-${sha}`);
  return { sha };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    publishFormaHitlImage();
  } catch (error) {
    console.error(redact(error.message, [process.env.GH_TOKEN || ""]));
    process.exit(1);
  }
}
