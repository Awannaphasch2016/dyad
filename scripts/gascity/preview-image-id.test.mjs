import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  hashPreviewContext,
  isIgnored,
  parseDockerignore,
} from "./preview-image-id.mjs";

const REPO_DOCKERIGNORE = new URL("../../.dockerignore", import.meta.url);

function writeFixture(root, files) {
  mkdirSync(root, { recursive: true });
  for (const [name, contents] of files) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
}

test("repository dockerignore keeps .env.example and drops git, github, and logs", () => {
  const rules = parseDockerignore(readFileSync(REPO_DOCKERIGNORE, "utf8"));
  assert.equal(isIgnored(".git/config", rules), true);
  assert.equal(isIgnored(".github/workflows/preview.yml", rules), true);
  assert.equal(isIgnored(".env.local", rules), true);
  assert.equal(isIgnored("nested/.env.secret", rules), true);
  assert.equal(isIgnored(".env.example", rules), false);
  assert.equal(isIgnored("src/main.ts", rules), false);
  assert.equal(isIgnored("notes.log", rules), true);
  assert.equal(isIgnored("src/debug.log", rules), true);
  assert.equal(isIgnored("coverage/index.html", rules), true);
  assert.equal(isIgnored("node_modules/left-pad/index.js", rules), true);
});

test("context hash ignores dockerignored files and changes when a sent file changes", () => {
  const root = mkdtempSync(join(tmpdir(), "preview-image-id-"));
  try {
    writeFixture(root, [
      ["Dockerfile.gascity", "FROM scratch\n"],
      [".dockerignore", ".git\n.env\n.env.*\n!.env.example\n*.log\n"],
      ["src/app.js", "same\n"],
      [".env.example", "PUBLIC=1\n"],
      [".env.local", "SECRET=1\n"],
      [".git/config", "secret-remote\n"],
      ["debug.log", "noise\n"],
    ]);
    const first = hashPreviewContext(root);
    assert.match(first, /^[0-9a-f]{64}$/);
    writeFileSync(join(root, ".git/config"), "changed-remote\n");
    writeFileSync(join(root, ".env.local"), "SECRET=2\n");
    writeFileSync(join(root, "debug.log"), "more noise\n");
    assert.equal(hashPreviewContext(root), first);
    writeFileSync(join(root, "src/app.js"), "changed\n");
    assert.notEqual(hashPreviewContext(root), first);
    const afterSource = hashPreviewContext(root);
    writeFileSync(join(root, ".env.example"), "PUBLIC=2\n");
    assert.notEqual(hashPreviewContext(root), afterSource);
    assert.equal(hashPreviewContext(root), hashPreviewContext(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
