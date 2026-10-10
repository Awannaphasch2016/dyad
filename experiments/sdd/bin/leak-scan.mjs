#!/usr/bin/env node
// Scan a directory tree (or a text file with --text) for strings that would
// show the worker learned about the ground truth or this harness.
// Usage: node leak-scan.mjs <dir> [--text <file>] [--out <json>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { LEAK_MARKERS, arg, writeJson } from "./lib.mjs";

const SKIP_DIRS = new Set([".git", "node_modules", "vendor"]);
const MAX_BYTES = 5 * 1024 * 1024;

export function scanText(text, file, markers = LEAK_MARKERS) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const marker of markers) {
      if (line.toLowerCase().includes(marker.toLowerCase()))
        hits.push({ file, line: i + 1, marker });
    }
  });
  return hits;
}

export function scanTree(root, markers = LEAK_MARKERS) {
  const hits = [];
  let files = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile() || statSync(full).size > MAX_BYTES) continue;
      files++;
      const buf = readFileSync(full);
      if (buf.subarray(0, 1024).includes(0)) continue;
      hits.push(
        ...scanText(buf.toString("utf8"), relative(root, full), markers),
      );
    }
  };
  walk(root);
  return { files_scanned: files, hits };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dir = process.argv[2];
  const textFile = arg("text");
  const out = arg("out");
  let result;
  if (textFile && typeof textFile === "string") {
    const hits = scanText(readFileSync(textFile, "utf8"), textFile);
    result = { files_scanned: 1, hits };
  } else if (dir && !dir.startsWith("--")) {
    result = scanTree(dir);
  } else {
    console.error("usage: leak-scan.mjs <dir> | --text <file> [--out <json>]");
    process.exit(2);
  }
  result.markers = LEAK_MARKERS;
  const json = JSON.stringify(result, null, 2);
  if (typeof out === "string") writeJson(out, result);
  else console.log(json);
  if (typeof out === "string")
    console.error(
      `${result.hits.length} hits in ${result.files_scanned} files`,
    );
}
