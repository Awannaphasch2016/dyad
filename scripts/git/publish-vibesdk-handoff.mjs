// Materialize the kept Dyad host onto Awannaphasch2016/vibesdk and open a PR.
// GitHub Actions exposes the VIBESDK secret as GH_TOKEN. This script never prints it.

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOrganizationRun } from "../../deploy/preview/vibesdk-org-run.mjs";
import { VIBESDK_SHA } from "../../deploy/preview/vibesdk.mjs";
import {
  patchAuthButton,
  patchAuthContext,
  patchAuthRoutes,
  patchClerkDocument,
  patchClerkSecurity,
  patchGlobalHeader,
  patchLoginModal,
  sharedRoleSource,
  sharedSignInSource,
} from "../../deploy/preview/vibesdk-shared-auth.mjs";

const REPO = "Awannaphasch2016/vibesdk";
const BRANCH = "cursor/dyad-handoff-0539";
const REMOTE = `https://github.com/${REPO}.git`;

function token() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
}

function redact(text) {
  const secret = token();
  if (!secret) return text;
  return String(text).split(secret).join("[redacted]");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    throw new Error(
      redact(
        `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
      ),
    );
  }
  return result.stdout ?? "";
}

async function github(path, tokenValue) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenValue}`,
      "User-Agent": "dyad-vibesdk-handoff",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    scopes: response.headers.get("x-oauth-scopes") || "",
    body: text,
  };
}

export async function applyKeptHost(checkout) {
  const files = [
    ["worker/api/routes/authRoutes.ts", patchAuthRoutes],
    ["src/components/auth/login-modal.tsx", patchLoginModal],
    ["src/contexts/auth-context.tsx", patchAuthContext],
    ["src/components/auth/auth-button.tsx", patchAuthButton],
    ["src/components/layout/global-header.tsx", patchGlobalHeader],
    ["index.html", patchClerkDocument],
    ["worker/config/security.ts", patchClerkSecurity],
  ];
  for (const [relative, patch] of files) {
    const path = join(checkout, relative);
    await writeFile(path, patch(await readFile(path, "utf8")));
  }
  await mkdir(join(checkout, "worker/api/controllers/auth"), {
    recursive: true,
  });
  await mkdir(join(checkout, "src/components/auth"), { recursive: true });
  await writeFile(
    join(checkout, "worker/api/controllers/auth/sharedSignIn.ts"),
    sharedSignInSource(),
  );
  await writeFile(
    join(checkout, "src/components/auth/shared-role.tsx"),
    sharedRoleSource(),
  );
  await applyOrganizationRun(checkout);
  await mkdir(join(checkout, "docs"), { recursive: true });
  await writeFile(
    join(checkout, "docs/dyad-handoff.md"),
    await readFile(
      new URL("../../plans/vibesdk-minimal-host.md", import.meta.url),
      "utf8",
    ),
  );
}

async function prepareCheckout(root) {
  await rm(root, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", REMOTE, root]);
  const head = run("git", ["-C", root, "rev-parse", "HEAD"]).trim();
  if (head !== VIBESDK_SHA) {
    throw new Error(
      `vibesdk main is ${head}, expected ${VIBESDK_SHA}. Refusing to patch a different commit.`,
    );
  }
  await applyKeptHost(root);
}

async function publishWithBodyFile() {
  const secret = token();
  if (!secret) {
    throw new Error(
      "The VIBESDK secret was not available to this process. GitHub Actions must pass it as GH_TOKEN. This session cannot read Actions secrets directly.",
    );
  }
  const me = await github("/user", secret);
  if (me.status !== 200) {
    throw new Error(
      `The VIBESDK token cannot call GitHub as a user (HTTP ${me.status}). It needs to be a personal access token, not an empty or revoked value.`,
    );
  }
  const login = JSON.parse(me.body).login;
  console.log(`token_login=${login}`);
  console.log(`oauth_scopes=${me.scopes || "fine-grained or hidden"}`);
  const repo = await github(`/repos/${REPO}`, secret);
  if (repo.status !== 200) {
    throw new Error(
      `The VIBESDK token cannot read ${REPO} (HTTP ${repo.status}). Grant the token access to that repository.`,
    );
  }
  const permissions = JSON.parse(repo.body).permissions ?? {};
  console.log(`repo_permissions=${JSON.stringify(permissions)}`);
  if (permissions.push !== true) {
    throw new Error(
      "The VIBESDK token is missing Contents write on Awannaphasch2016/vibesdk. For a fine-grained token, set Contents to Read and write and Pull requests to Read and write. For a classic token, enable the repo scope.",
    );
  }
  const root = join(tmpdir(), "vibesdk-handoff");
  await prepareCheckout(root);
  run("git", ["-C", root, "checkout", "-B", BRANCH]);
  run("git", ["-C", root, "add", "-A"]);
  if (!run("git", ["-C", root, "status", "--porcelain"]).trim()) {
    throw new Error("The kept host produced no changes.");
  }
  run("git", ["-C", root, "config", "user.name", login]);
  run("git", [
    "-C",
    root,
    "config",
    "user.email",
    `${login}@users.noreply.github.com`,
  ]);
  run("git", [
    "-C",
    root,
    "commit",
    "-m",
    "Bring the organization host over from Dyad.\n\nProject access is assignment, and the question is one line in the chat.",
  ]);
  const env = { ...process.env, GH_TOKEN: secret };
  run("gh", ["auth", "setup-git"], { cwd: root, env });
  const pushed = spawnSync(
    "git",
    ["-C", root, "push", "-u", "origin", BRANCH],
    { encoding: "utf8", env },
  );
  if (pushed.status !== 0) {
    run(
      "git",
      ["-C", root, "push", "--force-with-lease", "-u", "origin", BRANCH],
      { env },
    );
  }
  const bodyPath = join(root, ".handoff-pr-body.md");
  await writeFile(
    bodyPath,
    await readFile(new URL("./vibesdk-handoff-pr.md", import.meta.url), "utf8"),
  );
  const existing = spawnSync(
    "gh",
    ["pr", "view", BRANCH, "--repo", REPO, "--json", "url"],
    { encoding: "utf8", env },
  );
  if (existing.status === 0) {
    console.log(JSON.parse(existing.stdout).url);
    return;
  }
  const created = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--repo",
      REPO,
      "--base",
      "main",
      "--head",
      BRANCH,
      "--title",
      "Bring the organization host over from Dyad",
      "--body-file",
      bodyPath,
    ],
    { encoding: "utf8", env },
  );
  if (created.status !== 0) {
    throw new Error(
      redact(
        `gh pr create failed\n${created.stdout ?? ""}\n${created.stderr ?? ""}\nIf this is HTTP 403, the token also needs Pull requests: Read and write on ${REPO}.`,
      ),
    );
  }
  console.log((created.stdout ?? "").trim());
}

const checkOnly = process.argv.includes("--check");
if (checkOnly) {
  const root = join(tmpdir(), "vibesdk-handoff-check");
  await prepareCheckout(root);
  console.log("patches_applied=yes");
} else if (process.argv.includes("--publish")) {
  await publishWithBodyFile();
} else {
  console.error("Pass --check or --publish");
  process.exit(2);
}
