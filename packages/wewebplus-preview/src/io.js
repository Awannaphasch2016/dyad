import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIGEST = /^ghcr\.io\/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/;

export function defaultExec(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function readSavedPreviews(stateDir) {
  if (!stateDir || !existsSync(stateDir)) return [];
  return readdirSync(stateDir)
    .filter((name) => /^preview-\d+\.env$/.test(name))
    .map((name) => {
      const pr = name.slice("preview-".length, -".env".length);
      const text = readFileSync(join(stateDir, name), "utf8");
      const image = (text.match(/^PREVIEW_IMAGE=(.*)$/m) || [])[1] || "";
      const hasToken = /^CLOUDFLARE_TUNNEL_TOKEN=\S/m.test(text);
      return {
        pr,
        digest: DIGEST.test(image) ? image : "",
        tunnel: hasToken ? "named" : "absent",
      };
    });
}

export function defaultStateDir(env) {
  return (
    env.PREVIEW_STATE_DIR || join(homedir(), ".local/state/wewebplus-preview")
  );
}

export async function probePreview(pr, fetchImpl) {
  const url = `https://pr-${pr}.anakwannaphaschaiyong.com`;
  const empty = { pr: Number(pr), url, http: 0, bridge: "no" };
  try {
    const response = await fetchImpl(url, { redirect: "manual" });
    const body =
      typeof response.text === "function" ? await response.text() : "";
    return {
      pr: Number(pr),
      url,
      http: Number(response.status) || 0,
      bridge: String(body).includes("data-dyad-browser-bridge") ? "yes" : "no",
    };
  } catch {
    return empty;
  }
}

export function repoHasResumeScript(repo) {
  return Boolean(
    repo && existsSync(join(repo, "scripts/gascity/preview-resume.sh")),
  );
}

export function tokenFileExists(env) {
  return Boolean(env.NSC_TOKEN_FILE && existsSync(env.NSC_TOKEN_FILE));
}
