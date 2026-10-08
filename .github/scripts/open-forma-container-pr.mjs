import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMA_REPOSITORY = "Awannaphasch2016/forma";
export const FORMA_BRANCH = "cursor/forma-container-5014";
export const FORMA_BASE_BRANCH = "main";
export const BOT_NAME = "dyad-harness[bot]";
export const BOT_EMAIL = "5221649+dyad-harness[bot]@users.noreply.github.com";

const FORBIDDEN = [
  "proud-salad",
  "ep-young-wave",
  "mute-credit",
  "ep-wild-paper",
  "/opt/gascity/weaver-plus",
  "multi tenant HITL",
];

export function assertSafeText(text) {
  const value = String(text);
  for (const marker of FORBIDDEN) {
    if (value.includes(marker)) {
      throw new Error(`Refusing container text that mentions ${marker}`);
    }
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

export function clearCheckoutGitAuth() {
  for (const key of [
    "http.https://github.com/.extraheader",
    "http.extraheader",
  ]) {
    try {
      execFileSync("git", ["config", "--global", "--unset-all", key], {
        stdio: "ignore",
      });
    } catch {
      // The checkout credential header is already absent.
    }
  }
  let names = "";
  try {
    names = execFileSync(
      "git",
      ["config", "--show-origin", "--name-only", "--get-regexp", "extraheader"],
      { encoding: "utf8" },
    );
  } catch {
    names = "";
  }
  const remaining = names
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  console.log(
    `git_extraheader=${remaining.length ? "still_present" : "cleared"}`,
  );
  return remaining.length;
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

export function planFormaContainer({
  entries,
  packageJson = null,
  gascityDockerfile,
  entrypoint,
}) {
  const names = new Set(entries);
  const files = [];
  const isDyadApp =
    packageJson?.name === "dyad" || names.has("Dockerfile.gascity");

  if (isDyadApp) {
    if (!names.has("compose.dev.yml")) {
      files.push({ path: "compose.dev.yml", contents: devCompose() });
    }
    assertFilesSafe(files);
    return { kind: "dyad-dev-compose", files };
  }

  if (!names.has("Dockerfile")) {
    if (packageJson) {
      files.push({
        path: "Dockerfile",
        contents: nodeDockerfile(entries, packageJson),
      });
      if (!names.has(".dockerignore")) {
        files.push({ path: ".dockerignore", contents: dockerIgnore() });
      }
    } else {
      if (!gascityDockerfile || !entrypoint) {
        throw new Error("The Dev container sources are missing.");
      }
      files.push({ path: "Dockerfile", contents: gascityDockerfile });
      files.push({
        path: "docker/gascity-entrypoint.sh",
        contents: entrypoint,
      });
      if (!names.has(".dockerignore")) {
        files.push({ path: ".dockerignore", contents: dockerIgnore() });
      }
    }
  }

  if (!names.has("compose.dev.yml")) {
    files.push({
      path: "compose.dev.yml",
      contents: packageJson && !isDyadApp ? nodeCompose() : devCompose(),
    });
  }
  assertFilesSafe(files);
  return {
    kind: packageJson ? "node-app" : "dev-stage",
    files,
  };
}

function assertFilesSafe(files) {
  for (const file of files) assertSafeText(file.contents);
}

export function formaMergeBody(pull) {
  const baseRepo = pull.base?.repo?.full_name;
  if (baseRepo && baseRepo !== FORMA_REPOSITORY) {
    throw new Error(`Refusing to merge ${baseRepo}`);
  }
  if (pull.base?.ref !== FORMA_BASE_BRANCH) {
    throw new Error(`Refusing to merge base ${pull.base?.ref}`);
  }
  if (pull.head?.ref !== FORMA_BRANCH) {
    throw new Error(`Refusing to merge head ${pull.head?.ref}`);
  }
  return {
    commit_title: "Add the Forma dev container",
    merge_method: "squash",
  };
}

export function pullRequestCopy(kind) {
  if (kind === "node-app") {
    return {
      title: "Add the Forma dev container",
      body: [
        "Adds a Dev container for the Forma app.",
        "",
        "The image installs from the lockfile and starts the app. Secrets stay in the Dev environment. This pull request does not deploy.",
      ].join("\n"),
    };
  }
  if (kind === "dyad-dev-compose") {
    return {
      title: "Add the Forma dev container",
      body: [
        "Adds the Dev Compose project for the Forma container.",
        "",
        "The service runs the existing image with the browser bridge enabled on port 8373. It does not target the production host. This pull request does not deploy.",
      ].join("\n"),
    };
  }
  return {
    title: "Add the Forma dev container",
    body: [
      "Adds the Forma Dev container.",
      "",
      "The image is the browser-bridge runtime. noVNC stays on port 6080, and the bridge listens on port 8373 inside the container. `NOVNC_PASSWORD` is supplied when the container starts and is not stored in the repo.",
      "",
      "This pull request does not deploy.",
    ].join("\n"),
  };
}

function devCompose() {
  return `# Dev stage only. Do not run this on the production host.
services:
  forma:
    build: .
    shm_size: 1gb
    environment:
      DYAD_BROWSER_BRIDGE: "1"
      DYAD_BROWSER_BRIDGE_PORT: "8373"
      NOVNC_PORT: "6080"
      GAS_CITY_HOST_BRIDGE_PORT: "32100"
    ports:
      - "6080:6080"
`;
}

function dockerIgnore() {
  return `.git
node_modules
out
userData
`;
}

function nodeCompose() {
  return `# Dev stage only. Do not run this on the production host.
services:
  forma:
    build: .
    ports:
      - "3000:3000"
`;
}

function nodeDockerfile(entries, packageJson) {
  const names = new Set(entries);
  const script = packageJson.scripts?.start
    ? "start"
    : packageJson.scripts?.dev
      ? "dev"
      : "start";
  const build = packageJson.scripts?.build
    ? `\nRUN ${names.has("pnpm-lock.yaml") ? "pnpm" : names.has("yarn.lock") ? "yarn" : "npm"} run build`
    : "";
  const runner = names.has("pnpm-lock.yaml")
    ? "pnpm"
    : names.has("yarn.lock")
      ? "yarn"
      : "npm";
  if (names.has("pnpm-lock.yaml") && names.has("pnpm-workspace.yaml")) {
    return `FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile${build}
EXPOSE 3000
CMD ["pnpm", "run", "${script}"]
`;
  }
  const lockfiles = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".npmrc",
  ].filter((name) => names.has(name));
  const copyList = ["package.json", ...lockfiles].join(" ");
  let install = "npm install";
  if (names.has("pnpm-lock.yaml")) {
    install = "corepack enable && pnpm install --frozen-lockfile";
  } else if (names.has("yarn.lock")) {
    install = "corepack enable && yarn install --frozen-lockfile";
  } else if (names.has("package-lock.json")) {
    install = "npm ci";
  }
  return `FROM node:24-bookworm-slim
WORKDIR /app
COPY ${copyList} ./
RUN ${install}
COPY . .${build}
EXPOSE 3000
CMD ["${runner}", "run", "${script}"]
`;
}

function run(command, args, options = {}) {
  const { input, ...rest } = options;
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio:
      input === undefined
        ? ["ignore", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    ...(input === undefined ? {} : { input }),
    ...rest,
  });
}

function runOrThrow(command, args, options, secrets) {
  try {
    return run(command, args, options);
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    const stdout = error.stdout?.toString?.() ?? "";
    const message = redact(`${error.message}\n${stdout}\n${stderr}`, secrets);
    throw new Error(message);
  }
}

export function openFormaContainerPullRequest({
  repository = FORMA_REPOSITORY,
  branch = FORMA_BRANCH,
  baseBranch = FORMA_BASE_BRANCH,
  gascityDockerfile,
  entrypoint,
  env = process.env,
} = {}) {
  if (repository !== FORMA_REPOSITORY) {
    throw new Error(`Refusing repository ${repository}`);
  }
  if (branch !== FORMA_BRANCH) {
    throw new Error(`Refusing branch ${branch}`);
  }
  const token = env.GH_TOKEN || "";
  if (!token) throw new Error("GH_TOKEN is missing.");
  const secrets = [token];
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  const note = (line) => {
    const safe = redact(line, secrets);
    console.log(safe);
    if (summaryPath) {
      writeFileSync(summaryPath, `${safe}\n`, { flag: "a" });
    }
  };

  const view = ghJson(
    ["repo", "view", repository, "--json", "isEmpty,defaultBranchRef"],
    env,
    secrets,
  );
  const resolvedBase = view.defaultBranchRef?.name || baseBranch;
  if (!view.isEmpty && resolvedBase !== baseBranch) {
    throw new Error(`Refusing base branch ${resolvedBase}`);
  }

  const branchRef = view.isEmpty
    ? null
    : missingOrThrow(
        () =>
          ghJson(
            ["api", `repos/${repository}/git/ref/heads/${branch}`],
            env,
            secrets,
          ),
        secrets,
      );
  let parentSha = null;
  let treeSha = null;
  let entries = [];
  let packageJson = null;
  if (!view.isEmpty) {
    const baseRef =
      branchRef ??
      ghJson(
        ["api", `repos/${repository}/git/ref/heads/${resolvedBase}`],
        env,
        secrets,
      );
    parentSha = baseRef.object.sha;
    const commit = ghJson(
      ["api", `repos/${repository}/git/commits/${parentSha}`],
      env,
      secrets,
    );
    treeSha = commit.tree.sha;
    const tree = ghJson(
      ["api", `repos/${repository}/git/trees/${treeSha}`],
      env,
      secrets,
    );
    entries = tree.tree.map((item) => item.path);
    const pkg = tree.tree.find(
      (item) => item.path === "package.json" && item.type === "blob",
    );
    if (pkg) {
      const blob = ghJson(
        ["api", `repos/${repository}/git/blobs/${pkg.sha}`],
        env,
        secrets,
      );
      packageJson = JSON.parse(
        Buffer.from(blob.content, "base64").toString("utf8"),
      );
    }
  }

  const plan = planFormaContainer({
    entries,
    packageJson,
    gascityDockerfile,
    entrypoint,
  });
  const missing = plan.files.filter(
    (file) => !contentExists(repository, file.path, parentSha, env, secrets),
  );
  console.log(
    `forma_entries=${entries
      .filter((name) => !name.startsWith("."))
      .slice(0, 40)
      .join(",")}`,
  );
  console.log(
    `forma_container_files=${missing.map((file) => file.path).join(",")}`,
  );

  if (missing.length) {
    const blobs = missing.map((file) => {
      const blob = ghJson(
        [
          "api",
          "--method",
          "POST",
          `repos/${repository}/git/blobs`,
          "--input",
          "-",
        ],
        env,
        secrets,
        JSON.stringify({ content: file.contents, encoding: "utf-8" }),
      );
      return {
        path: file.path,
        mode: file.path.endsWith(".sh") ? "100755" : "100644",
        type: "blob",
        sha: blob.sha,
      };
    });
    const treeBody = treeSha
      ? { base_tree: treeSha, tree: blobs }
      : { tree: blobs };
    const nextTree = ghJson(
      [
        "api",
        "--method",
        "POST",
        `repos/${repository}/git/trees`,
        "--input",
        "-",
      ],
      env,
      secrets,
      JSON.stringify(treeBody),
    );
    const copy = pullRequestCopy(plan.kind);
    const nextCommit = ghJson(
      [
        "api",
        "--method",
        "POST",
        `repos/${repository}/git/commits`,
        "--input",
        "-",
      ],
      env,
      secrets,
      JSON.stringify({
        message: `${copy.title}\n\nThe Dev container does not store runtime secrets.\n`,
        tree: nextTree.sha,
        parents: parentSha ? [parentSha] : [],
        author: { name: BOT_NAME, email: BOT_EMAIL },
      }),
    );
    if (view.isEmpty) {
      ghJson(
        [
          "api",
          "--method",
          "POST",
          `repos/${repository}/git/refs`,
          "--input",
          "-",
        ],
        env,
        secrets,
        JSON.stringify({
          ref: `refs/heads/${baseBranch}`,
          sha: nextCommit.sha,
        }),
      );
      note(
        "forma_container=main forma_pr=none reason=repository_had_no_commits",
      );
      return { url: null, kind: plan.kind, base: baseBranch };
    }
    if (branchRef) {
      ghJson(
        [
          "api",
          "--method",
          "PATCH",
          `repos/${repository}/git/refs/heads/${branch}`,
          "--input",
          "-",
        ],
        env,
        secrets,
        JSON.stringify({ sha: nextCommit.sha }),
      );
    } else {
      ghJson(
        [
          "api",
          "--method",
          "POST",
          `repos/${repository}/git/refs`,
          "--input",
          "-",
        ],
        env,
        secrets,
        JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: nextCommit.sha,
        }),
      );
    }
  } else if (view.isEmpty || !branchRef) {
    note("forma_container=already_present");
    return { url: null, kind: plan.kind, base: resolvedBase };
  }

  const owner = repository.split("/")[0];
  const pulls = ghJson(
    [
      "api",
      `repos/${repository}/pulls?state=open&base=${resolvedBase}&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    ],
    env,
    secrets,
  );
  let pull = Array.isArray(pulls) ? pulls[0] : null;
  if (!pull) {
    const copy = pullRequestCopy(plan.kind);
    pull = ghJson(
      ["api", "--method", "POST", `repos/${repository}/pulls`, "--input", "-"],
      env,
      secrets,
      JSON.stringify({
        title: copy.title,
        head: branch,
        base: resolvedBase,
        body: copy.body,
      }),
    );
  }
  note(`forma_pr=${pull.html_url}`);
  const merged = mergeFormaPullRequest({
    repository,
    number: pull.number,
    env,
    secrets,
  });
  note(`forma_merged=${merged.merged} forma_sha=${merged.sha}`);
  return {
    url: pull.html_url,
    merged: merged.merged,
    sha: merged.sha,
    kind: plan.kind,
    base: resolvedBase,
  };
}

function mergeFormaPullRequest({ repository, number, env, secrets }) {
  const pull = ghJson(
    ["api", `repos/${repository}/pulls/${number}`],
    env,
    secrets,
  );
  if (pull.merged) {
    return { merged: true, sha: pull.merge_commit_sha };
  }
  const body = formaMergeBody(pull);
  try {
    return ghJson(
      [
        "api",
        "--method",
        "PUT",
        `repos/${repository}/pulls/${number}/merge`,
        "--input",
        "-",
      ],
      env,
      secrets,
      JSON.stringify(body),
    );
  } catch (error) {
    if (!/405|not allowed/i.test(String(error.message))) throw error;
    return ghJson(
      [
        "api",
        "--method",
        "PUT",
        `repos/${repository}/pulls/${number}/merge`,
        "--input",
        "-",
      ],
      env,
      secrets,
      JSON.stringify({ ...body, merge_method: "merge" }),
    );
  }
}

function contentExists(repository, filePath, ref, env, secrets) {
  if (!ref) return false;
  try {
    gh(
      ["api", `repos/${repository}/contents/${filePath}?ref=${ref}`],
      env,
      secrets,
    );
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function missingOrThrow(fn) {
  try {
    return fn();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error) {
  return /404|Not Found/.test(String(error?.message));
}

function gh(args, env, secrets, input) {
  return runOrThrow(
    "gh",
    args,
    { env, ...(input === undefined ? {} : { input }) },
    secrets,
  );
}

function ghJson(args, env, secrets, input) {
  const text = gh(args, env, secrets, input);
  return text ? JSON.parse(text) : null;
}

function readCheckoutFile(name) {
  const file = path.join(process.cwd(), name);
  if (!existsSync(file)) {
    throw new Error(`Missing ${name}`);
  }
  return readFileSync(file, "utf8");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    openFormaContainerPullRequest({
      gascityDockerfile: readCheckoutFile("Dockerfile.gascity"),
      entrypoint: readCheckoutFile("docker/gascity-entrypoint.sh"),
    });
  } catch (error) {
    console.error(redact(error.message, [process.env.GH_TOKEN || ""]));
    process.exit(1);
  }
}
