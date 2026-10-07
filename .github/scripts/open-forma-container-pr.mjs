import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
    files.push({ path: "compose.dev.yml", contents: devCompose() });
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

function nodeDockerfile(entries, packageJson) {
  const names = new Set(entries);
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
  const script = packageJson.scripts?.start
    ? "start"
    : packageJson.scripts?.dev
      ? "dev"
      : "start";
  return `FROM node:24-bookworm-slim
WORKDIR /app
COPY ${copyList} ./
RUN ${install}
COPY . .
EXPOSE 3000
CMD ["npm", "run", "${script}"]
`;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
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

  runOrThrow("gh", ["auth", "setup-git"], { env }, secrets);
  const view = JSON.parse(
    runOrThrow(
      "gh",
      ["repo", "view", repository, "--json", "isEmpty,defaultBranchRef"],
      { env },
      secrets,
    ),
  );
  const resolvedBase = view.defaultBranchRef?.name || baseBranch;
  if (resolvedBase !== baseBranch) {
    throw new Error(`Refusing base branch ${resolvedBase}`);
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "forma-container-"));
  const repoDir = path.join(workDir, "forma");
  try {
    if (view.isEmpty) {
      mkdirSync(repoDir, { recursive: true });
      runOrThrow("git", ["init", "-b", baseBranch, repoDir], { env }, secrets);
      configureBot(repoDir, env, secrets);
      const plan = writeContainerFiles(repoDir, {
        gascityDockerfile,
        entrypoint,
      });
      commitAll(repoDir, plan, env, secrets);
      runOrThrow(
        "git",
        ["remote", "add", "origin", `https://github.com/${repository}.git`],
        { cwd: repoDir, env },
        secrets,
      );
      runOrThrow(
        "git",
        ["push", "origin", `HEAD:${baseBranch}`],
        { cwd: repoDir, env },
        secrets,
      );
      note(
        `forma_container=main forma_pr=none reason=repository_had_no_commits`,
      );
      return { url: null, kind: plan.kind, base: baseBranch };
    }

    const remoteBranch = runOrThrow(
      "git",
      ["ls-remote", "--heads", `https://github.com/${repository}.git`, branch],
      { env },
      secrets,
    ).trim();
    const cloneArgs = [
      "clone",
      "--depth",
      "1",
      `https://github.com/${repository}.git`,
      repoDir,
    ];
    if (remoteBranch) {
      cloneArgs.splice(1, 0, "--branch", branch);
    } else {
      cloneArgs.splice(1, 0, "--branch", resolvedBase);
    }
    runOrThrow("git", cloneArgs, { env }, secrets);
    configureBot(repoDir, env, secrets);
    if (!remoteBranch) {
      runOrThrow(
        "git",
        ["checkout", "-b", branch],
        { cwd: repoDir, env },
        secrets,
      );
    }

    const plan = writeContainerFiles(repoDir, {
      gascityDockerfile,
      entrypoint,
    });
    const status = runOrThrow(
      "git",
      ["status", "--porcelain"],
      { cwd: repoDir, env },
      secrets,
    ).trim();
    if (status) {
      commitAll(repoDir, plan, env, secrets);
      runOrThrow(
        "git",
        ["push", "origin", `HEAD:${branch}`],
        { cwd: repoDir, env },
        secrets,
      );
    }

    const existing = runOrThrow(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branch,
        "--base",
        resolvedBase,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url",
      ],
      { env },
      secrets,
    ).trim();
    if (existing) {
      note(`forma_pr=${existing}`);
      return { url: existing, kind: plan.kind, base: resolvedBase };
    }
    if (!status && !remoteBranch) {
      note("forma_container=already_present");
      return { url: null, kind: plan.kind, base: resolvedBase };
    }
    const copy = pullRequestCopy(plan.kind);
    const bodyFile = path.join(workDir, "pr-body.md");
    writeFileSync(bodyFile, `${copy.body}\n`);
    const url = runOrThrow(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        repository,
        "--base",
        resolvedBase,
        "--head",
        branch,
        "--title",
        copy.title,
        "--body-file",
        bodyFile,
      ],
      { env },
      secrets,
    ).trim();
    note(`forma_pr=${url}`);
    return { url, kind: plan.kind, base: resolvedBase };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function configureBot(repoDir, env, secrets) {
  runOrThrow(
    "git",
    ["config", "user.name", BOT_NAME],
    { cwd: repoDir, env },
    secrets,
  );
  runOrThrow(
    "git",
    ["config", "user.email", BOT_EMAIL],
    { cwd: repoDir, env },
    secrets,
  );
}

function writeContainerFiles(repoDir, sources) {
  const entries = readTopLevel(repoDir);
  let packageJson = null;
  const packagePath = path.join(repoDir, "package.json");
  if (existsSync(packagePath)) {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  }
  const plan = planFormaContainer({
    entries,
    packageJson,
    gascityDockerfile: sources.gascityDockerfile,
    entrypoint: sources.entrypoint,
  });
  const written = [];
  for (const file of plan.files) {
    const destination = path.join(repoDir, file.path);
    if (existsSync(destination)) continue;
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.contents);
    if (file.path.endsWith(".sh")) {
      run("chmod", ["755", destination]);
    }
    written.push(file.path);
  }
  const visible = entries.filter((name) => !name.startsWith(".")).slice(0, 40);
  console.log(`forma_entries=${visible.join(",")}`);
  console.log(`forma_container_files=${written.join(",")}`);
  return { ...plan, written };
}

function readTopLevel(repoDir) {
  if (!existsSync(repoDir)) return [];
  return execFileSync("ls", ["-A", repoDir], { encoding: "utf8" })
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}

function commitAll(repoDir, plan, env, secrets) {
  if (!plan.written.length) return;
  const copy = pullRequestCopy(plan.kind);
  runOrThrow(
    "git",
    ["add", "--", ...plan.written],
    { cwd: repoDir, env },
    secrets,
  );
  const messageFile = path.join(repoDir, ".git", "COMMIT_MESSAGE");
  writeFileSync(
    messageFile,
    `${copy.title}\n\nThe Dev container does not store runtime secrets.\n`,
  );
  runOrThrow(
    "git",
    ["commit", "-F", messageFile],
    { cwd: repoDir, env },
    secrets,
  );
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
