// Thin wrapper over the gh binary. Everything that talks to GitHub goes
// through runGh so tests can substitute a fake.
import { spawn } from "node:child_process";

export class GhError extends Error {
  constructor(message, { code = "GH_ERROR", stderr = "", status = 1 } = {}) {
    super(message);
    this.code = code;
    this.stderr = stderr;
    this.status = status;
  }
}

export function makeGh(options = {}) {
  const bin = options.bin || process.env.OPS_AXI_GH || "gh";
  const repo = options.repo;

  return async function runGh(args, { allowFailure = false } = {}) {
    const full = repo && !args.includes("-R") ? [...args, "-R", repo] : args;
    const result = await new Promise((resolve) => {
      const child = spawn(bin, full, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ status: 127, stdout, stderr: error.message });
      });
      child.on("close", (status) => {
        resolve({ status: status ?? 1, stdout, stderr });
      });
    });
    if (result.status === 127) {
      throw new GhError(`gh is not installed or not on PATH (${bin})`, {
        code: "GH_NOT_INSTALLED",
        stderr: result.stderr,
        status: 127,
      });
    }
    if (result.status !== 0 && !allowFailure) {
      const message =
        result.stderr.trim() || `gh ${full.slice(0, 2).join(" ")} failed`;
      throw new GhError(message, {
        code: classify(message),
        stderr: result.stderr,
        status: result.status,
      });
    }
    return result;
  };
}

export function classify(stderr) {
  const text = stderr.toLowerCase();
  if (text.includes("gh auth login") || text.includes("http 401")) {
    return "AUTH_REQUIRED";
  }
  if (text.includes("http 403")) return "FORBIDDEN";
  if (text.includes("http 404") || text.includes("could not find")) {
    return "NOT_FOUND";
  }
  if (text.includes("workflow_dispatch") || text.includes("http 422")) {
    return "DISPATCH_REFUSED";
  }
  return "GH_ERROR";
}
