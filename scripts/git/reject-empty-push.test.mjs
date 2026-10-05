import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./reject-empty-push.sh", import.meta.url);

function git(repo, args) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "reject-empty-push-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "push-hook@example.com"]);
  git(repo, ["config", "user.name", "Push hook test"]);
  return repo;
}

function writeAndCommit(repo, name, contents, message) {
  writeFileSync(join(repo, name), contents);
  git(repo, ["add", name]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function runHook(repo, lines) {
  return spawnSync("sh", ["-e", script.pathname], {
    cwd: repo,
    input: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
    encoding: "utf8",
  });
}

function zeros() {
  return "0".repeat(40);
}

test("an empty commit is refused", () => {
  const repo = initRepo();
  try {
    writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    git(repo, ["commit", "--allow-empty", "-m", "wake"]);
    const empty = git(repo, ["rev-parse", "HEAD"]);
    const result = runHook(repo, [
      `refs/heads/main ${empty} refs/heads/main ${zeros()}`,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`Refusing to push empty commit ${empty}`),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a commit that changes a file is allowed", () => {
  const repo = initRepo();
  try {
    const sha = writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    const result = runHook(repo, [
      `refs/heads/main ${sha} refs/heads/main ${zeros()}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("deleting a remote branch is allowed", () => {
  const repo = initRepo();
  try {
    const sha = writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    const result = runHook(repo, [
      `refs/heads/main ${zeros()} refs/heads/main ${sha}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a merge commit with the first parent's tree is allowed", () => {
  const repo = initRepo();
  try {
    writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    git(repo, ["checkout", "-b", "side"]);
    writeAndCommit(repo, "side.txt", "side\n", "add side");
    git(repo, ["checkout", "main"]);
    git(repo, ["merge", "-s", "ours", "side", "-m", "merge side"]);
    const merge = git(repo, ["rev-parse", "HEAD"]);
    const result = runHook(repo, [
      `refs/heads/main ${merge} refs/heads/main ${zeros()}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an empty ancestor already on the remote does not block a later file change", () => {
  const repo = initRepo();
  try {
    writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    git(repo, ["commit", "--allow-empty", "-m", "wake"]);
    const empty = git(repo, ["rev-parse", "HEAD"]);
    writeAndCommit(repo, "readme.txt", "hello\nagain\n", "edit readme");
    const tip = git(repo, ["rev-parse", "HEAD"]);
    const result = runHook(repo, [
      `refs/heads/main ${tip} refs/heads/main ${empty}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("an empty commit already on a remote-tracking ref is not treated as new", () => {
  const repo = initRepo();
  try {
    writeAndCommit(repo, "readme.txt", "hello\n", "add readme");
    git(repo, ["commit", "--allow-empty", "-m", "wake"]);
    const empty = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["update-ref", "refs/remotes/origin/main", empty]);
    const result = runHook(repo, [
      `refs/heads/feature ${empty} refs/heads/feature ${zeros()}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
