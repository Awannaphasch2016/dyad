// Hash of the files Docker would send for Dockerfile.gascity.
// The tag is ctx-<hash>. A commit that does not change this hash reuses the image.

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DOCKERFILE = "Dockerfile.gascity";

export function parseDockerignore(text) {
  const rules = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const body = negate ? line.slice(1).trim() : line;
    if (!body) continue;
    const directoryOnly = body.endsWith("/");
    const pattern = directoryOnly ? body.slice(0, -1) : body;
    rules.push({ negate, directoryOnly, pattern });
  }
  return rules;
}

function globToRegExp(pattern) {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source);
}

function ruleMatches(rule, relPath) {
  if (rule.directoryOnly) {
    return relPath === rule.pattern || relPath.startsWith(`${rule.pattern}/`);
  }
  const expression = globToRegExp(rule.pattern);
  if (rule.pattern.includes("/")) {
    const rooted = rule.pattern.replace(/^\//, "");
    const rootedExpression = globToRegExp(rooted);
    return (
      relPath === rooted ||
      relPath.startsWith(`${rooted}/`) ||
      rootedExpression.test(relPath)
    );
  }
  if (expression.test(relPath)) return true;
  return relPath.split("/").some((segment) => expression.test(segment));
}

export function isIgnored(relPath, rules) {
  const normalized = String(relPath).replace(/\\/g, "/").replace(/^\.\//, "");
  let ignored = false;
  for (const rule of rules) {
    if (!ruleMatches(rule, normalized)) continue;
    ignored = !rule.negate;
  }
  return ignored;
}

function listContextFiles(root, rules) {
  const files = [];
  const walk = (directory, prefix) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isIgnored(relPath, rules)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relPath);
        continue;
      }
      files.push({ relPath, absolute, symlink: entry.isSymbolicLink() });
    }
  };
  walk(root, "");
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

export function hashPreviewContext(root) {
  const dockerignorePath = join(root, ".dockerignore");
  const dockerfilePath = join(root, DOCKERFILE);
  const rules = parseDockerignore(readFileSync(dockerignorePath, "utf8"));
  const hash = createHash("sha256");
  const add = (label, bytes) => {
    hash.update(label);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  };
  add("dockerignore", readFileSync(dockerignorePath));
  add("dockerfile", readFileSync(dockerfilePath));
  for (const file of listContextFiles(root, rules)) {
    if (file.symlink) {
      add(`link ${file.relPath}`, Buffer.from(readlinkSync(file.absolute)));
      continue;
    }
    const stat = lstatSync(file.absolute);
    if (!stat.isFile()) continue;
    add(`file ${file.relPath}`, readFileSync(file.absolute));
  }
  return hash.digest("hex");
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const root = process.argv[2] || process.cwd();
  process.stdout.write(`${hashPreviewContext(root)}\n`);
}
