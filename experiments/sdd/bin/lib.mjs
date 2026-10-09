// Shared helpers for the coordinator scripts. Node built-ins only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SDD_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CURSOR_API =
  process.env.CURSOR_API_URL ?? "https://api.cursor.com";

export function apiKey() {
  const key = process.env.CURSOR_API_KEY;
  if (!key)
    throw new Error(
      "CURSOR_API_KEY is not set (add it as a Cloud Agent Runtime Secret)",
    );
  return key;
}

export async function cursor(path, { method = "GET", body, raw = false } = {}) {
  const init = {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${apiKey()}:`).toString("base64"),
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${CURSOR_API}${path}`, init);
  const text = await res.text();
  if (raw) return { status: res.status, text };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`,
    );
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export function runDir(runId) {
  return join(SDD_ROOT, "runs", runId);
}

export function readRun(runId) {
  return JSON.parse(readFileSync(join(runDir(runId), "run.json"), "utf8"));
}

export function writeRun(runId, run) {
  mkdirSync(runDir(runId), { recursive: true });
  writeFileSync(
    join(runDir(runId), "run.json"),
    JSON.stringify(run, null, 2) + "\n",
  );
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

export const LEAK_MARKERS = [
  "dev25-git-con",
  "gitconference.git.or.th",
  "wewebserver",
  "Awannaphasch2016/dyad",
  "front/template/default",
  "experiments/sdd",
];
