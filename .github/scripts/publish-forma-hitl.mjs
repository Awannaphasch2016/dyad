import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORMA_REPOSITORY = "Awannaphasch2016/forma";
export const FORMA_BRANCH = "cursor/forma-agent-hitl-5014";
export const FORMA_BASE_BRANCH = "main";
export const PATCH_RELATIVE = "deploy/forma/agent-hitl.patch";
export const BOT_NAME = "dyad-harness[bot]";
export const BOT_EMAIL = "5221649+dyad-harness[bot]@users.noreply.github.com";

const FORBIDDEN = [
  "proud-salad",
  "ep-young-wave",
  "mute-credit",
  "ep-wild-paper",
  "/opt/gascity/weaver-plus",
  "multi tenant HITL",
  "FORMA_HITL_FIXTURE",
  "forma_fixture",
];

export function assertSafePatch(text) {
  const value = String(text);
  for (const marker of FORBIDDEN) {
    if (value.includes(marker)) {
      throw new Error(`Refusing Forma patch that mentions ${marker}`);
    }
  }
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
    commit_title:
      "Pause a Forma turn for one role and resume the same session.",
    merge_method: "squash",
  };
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
    throw new Error(redact(`${error.message}\n${stdout}\n${stderr}`, secrets));
  }
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

function note(line, env, secrets) {
  const safe = redact(line, secrets);
  console.log(safe);
  if (env.GITHUB_STEP_SUMMARY) {
    writeFileSync(env.GITHUB_STEP_SUMMARY, `${safe}\n`, { flag: "a" });
  }
}

export function publishFormaHitl({
  repository = FORMA_REPOSITORY,
  branch = FORMA_BRANCH,
  baseBranch = FORMA_BASE_BRANCH,
  patchPath = path.join(process.cwd(), PATCH_RELATIVE),
  env = process.env,
  workRoot = tmpdir(),
} = {}) {
  if (repository !== FORMA_REPOSITORY) {
    throw new Error(`Refusing repository ${repository}`);
  }
  if (branch !== FORMA_BRANCH) {
    throw new Error(`Refusing branch ${branch}`);
  }
  if (baseBranch !== FORMA_BASE_BRANCH) {
    throw new Error(`Refusing base branch ${baseBranch}`);
  }
  const token = env.GH_TOKEN || "";
  if (!token) throw new Error("GH_TOKEN is missing.");
  const secrets = [token];
  const patch = readFileSync(patchPath, "utf8");
  assertSafePatch(patch);

  clearCheckoutGitAuth();
  const helperPath = path.join(workRoot, "forma-git-ask.sh");
  writeFileSync(helperPath, credentialHelperSource(), { mode: 0o700 });
  const gitEnv = gitCredentialEnv(env, helperPath);
  const clone = path.join(workRoot, "forma-hitl");
  runOrThrow(
    "git",
    [
      "-c",
      "credential.helper=",
      "clone",
      "--depth",
      "1",
      "--branch",
      baseBranch,
      `https://github.com/${repository}.git`,
      clone,
    ],
    { env: gitEnv },
    secrets,
  );
  runOrThrow(
    "git",
    ["apply", "--index", patchPath],
    { cwd: clone, env: gitEnv },
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
      "Pause a Forma turn for one role and resume the same session.\n\nThe project belongs to the Wewebplus organization. A finished turn for one role waits for that role, and the answer continues the same session.\n",
    ],
    { cwd: clone, env: gitEnv },
    secrets,
  );
  runOrThrow(
    "git",
    [
      "push",
      `https://github.com/${repository}.git`,
      `HEAD:refs/heads/${branch}`,
    ],
    { cwd: clone, env: gitEnv },
    secrets,
  );

  const owner = repository.split("/")[0];
  const pulls = ghJson(
    [
      "api",
      `repos/${repository}/pulls?state=open&base=${baseBranch}&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    ],
    env,
    secrets,
  );
  let pull = Array.isArray(pulls) ? pulls[0] : null;
  if (!pull) {
    pull = ghJson(
      ["api", "--method", "POST", `repos/${repository}/pulls`, "--input", "-"],
      env,
      secrets,
      JSON.stringify({
        title: "Pause a Forma turn for one role and resume the same session.",
        head: branch,
        base: baseBranch,
        body: [
          "The studio belongs to one Wewebplus organization. A finished turn headed for the Project Manager or the Developer pauses for that role only. The answer continues the same agent session.",
          "",
          "This pull request does not deploy and does not read a production database.",
        ].join("\n"),
      }),
    );
  }
  note(`forma_pr=${pull.html_url}`, env, secrets);
  const merged = mergeFormaPullRequest({
    repository,
    number: pull.number,
    env,
    secrets,
  });
  note(`forma_merged=${merged.merged} forma_sha=${merged.sha}`, env, secrets);
  return { url: pull.html_url, merged: merged.merged, sha: merged.sha };
}

function mergeFormaPullRequest({ repository, number, env, secrets }) {
  const pull = ghJson(
    ["api", `repos/${repository}/pulls/${number}`],
    env,
    secrets,
  );
  if (pull.merged) return { merged: true, sha: pull.merge_commit_sha };
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

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    publishFormaHitl();
  } catch (error) {
    console.error(redact(error.message, [process.env.GH_TOKEN || ""]));
    process.exit(1);
  }
}
