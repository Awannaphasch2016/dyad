#!/usr/bin/env node
// Render specs/<name>/<version>/requirements.md from requirements.template.md
// by embedding the fixture files, so the worker receives one self-contained
// document and the verifier compares against the same bytes.
// Usage: node build-spec.mjs [specDir] [--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const check = args.includes("--check");
const specDir =
  args.find((a) => !a.startsWith("--")) ??
  join(import.meta.dirname, "..", "specs", "gitcon", "v1");

export function renderSpec(dir) {
  const template = readFileSync(join(dir, "requirements.template.md"), "utf8");
  const program = readFileSync(
    join(dir, "fixtures", "program.json"),
    "utf8",
  ).trimEnd();
  const fees = readFileSync(
    join(dir, "fixtures", "fees.json"),
    "utf8",
  ).trimEnd();
  for (const text of [program, fees]) JSON.parse(text);
  return template
    .replace("{{PROGRAM_JSON}}", program)
    .replace("{{FEES_JSON}}", fees);
}

export function specSha256(dir) {
  return createHash("sha256")
    .update(readFileSync(join(dir, "requirements.md")))
    .digest("hex");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const rendered = renderSpec(specDir);
  const target = join(specDir, "requirements.md");
  if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== rendered) {
      console.error(
        `${target} is stale; run node experiments/sdd/bin/build-spec.mjs`,
      );
      process.exit(1);
    }
    console.log(`requirements.md up to date, sha256 ${specSha256(specDir)}`);
  } else {
    writeFileSync(target, rendered);
    console.log(`wrote ${target}, sha256 ${specSha256(specDir)}`);
  }
}
