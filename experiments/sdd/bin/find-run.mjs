#!/usr/bin/env node
// Print GitHub Actions outputs for the run.json files touched by a push.
// Usage: node find-run.mjs <sha> [<before-sha>]
// Picks the newest run.json in the diff that has pr.head_sha set.
import { readFileSync, existsSync } from "node:fs";
import { sh } from "./lib.mjs";

const sha = process.argv[2];
const before = process.argv[3];
if (!sha) {
  console.error("usage: find-run.mjs <sha> [<before-sha>]");
  process.exit(2);
}
let changed;
try {
  const range =
    before && !/^0+$/.test(before) ? `${before}..${sha}` : `${sha}~1..${sha}`;
  changed = sh("git", ["diff", "--name-only", range]).split("\n");
} catch {
  changed = sh("git", ["show", "--name-only", "--format=", sha]).split("\n");
}
const candidates = changed.filter(
  (f) => /^experiments\/sdd\/runs\/[^/]+\/run\.json$/.test(f) && existsSync(f),
);
const ready = candidates
  .map((f) => ({ file: f, run: JSON.parse(readFileSync(f, "utf8")) }))
  .filter(({ run }) => run.pr?.head_sha && run.impl_repo);
if (ready.length === 0) {
  console.error(
    `no run.json with pr.head_sha in ${sha}; candidates: ${candidates.join(", ") || "none"}`,
  );
  process.exit(1);
}
ready.sort((a, b) => (a.run.run_id < b.run.run_id ? 1 : -1));
const { run } = ready[0];
const out = {
  run_id: run.run_id,
  impl_repo: run.impl_repo,
  head_sha: run.pr.head_sha,
  spec_sha256: run.spec_sha256,
  spec_version: run.spec_version,
  spec_dir: `experiments/sdd/specs/${run.spec_version.replace(/-v(\d+)$/, "/v$1")}`,
};
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
