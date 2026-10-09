// Start a workflow, find its run, wait for it, and read its result lines.
//
// Result lines are the convention the workflows already follow: one
// `key=value` per fact, printed by a step. The CLI collects them from the
// run log so the caller does not read the log.
import { GhError } from "./gh.js";

const RESULT_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(\S.*)$/;
const SENSITIVE_KEY = /TOKEN|KEY|SECRET|PASSWORD|ARN/i;
const SAFE_VALUE =
  /^(present|absent|stored|ok|broken|missing|present-but-not-a-private-key|http-\d{3}|[0-9]+|true|false)(\s+[a-z_]+=\S+)*$/;

export function parseResultLines(log) {
  const results = new Map();
  for (const raw of log.split(/\r?\n/)) {
    // gh run view --log prefixes every line with "job\tstep\ttimestamp ".
    const stripped = raw.replace(/^[^\t]*\t[^\t]*\t\S+Z\s/, "").trim();
    if (
      !stripped ||
      stripped.startsWith("##") ||
      stripped.includes("::add-mask::")
    ) {
      continue;
    }
    // Skip echoed script source, which gh prints in colour.
    if (stripped.includes("\u001b[")) continue;
    const match = RESULT_LINE.exec(stripped);
    if (!match) continue;
    const [, key, value] = match;
    results.set(key, redact(key, value));
  }
  return results;
}

export function redact(key, value) {
  if (SENSITIVE_KEY.test(key) && !SAFE_VALUE.test(value)) return "<redacted>";
  return value;
}

export function isDispatchRefusal(error) {
  if (!(error instanceof GhError)) return false;
  if (error.code === "DISPATCH_REFUSED" || error.code === "NOT_FOUND")
    return true;
  return /workflow_dispatch|default branch|could not find any workflows|HTTP 404|HTTP 422/i.test(
    error.message,
  );
}

async function listRuns(gh, { workflow, ref, limit = 10, event }) {
  const args = [
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    ref,
    "--limit",
    String(limit),
    "--json",
    "databaseId,createdAt,status,conclusion,event,headSha,url",
  ];
  if (event) args.push("--event", event);
  const { stdout } = await gh(args);
  return JSON.parse(stdout || "[]");
}

export async function startRun(
  gh,
  { workflow, ref, fields = [], sleep = defaultSleep, now = () => Date.now() },
) {
  const dispatchedAt = now();
  const args = ["workflow", "run", workflow, "--ref", ref];
  for (const field of fields) args.push("-f", field);
  try {
    await gh(args);
  } catch (error) {
    if (!isDispatchRefusal(error)) throw error;
    return rerunLatest(gh, {
      workflow,
      ref,
      reason: error.message.split("\n")[0],
    });
  }

  // gh workflow run does not return the run id. Poll for a dispatch run on
  // this branch created after we asked.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runs = await listRuns(gh, {
      workflow,
      ref,
      event: "workflow_dispatch",
    });
    const fresh = runs.find(
      (run) => Date.parse(run.createdAt) >= dispatchedAt - 5000,
    );
    if (fresh) return { mode: "dispatch", run: fresh };
    await sleep(3000);
  }
  throw new GhError(
    "Dispatch was accepted but no run appeared within 60 seconds",
    {
      code: "RUN_NOT_FOUND",
    },
  );
}

async function rerunLatest(gh, { workflow, ref, reason }) {
  const runs = await listRuns(gh, { workflow, ref, limit: 1 });
  const latest = runs[0];
  if (!latest) {
    throw new GhError(
      `GitHub refused the dispatch (${reason}) and there is no earlier run of ${workflow} on ${ref} to rerun`,
      { code: "NO_RUN_TO_RERUN" },
    );
  }
  if (latest.status !== "completed") {
    return { mode: "attach", run: latest, reason };
  }
  await gh(["run", "rerun", String(latest.databaseId)]);
  return { mode: "rerun", run: latest, reason };
}

export async function waitForRun(gh, runId, { interval = 15 } = {}) {
  const result = await gh(
    [
      "run",
      "watch",
      String(runId),
      "--exit-status",
      "--interval",
      String(interval),
    ],
    { allowFailure: true },
  );
  return result.status === 0 ? "success" : "failure";
}

export async function readResults(gh, runId) {
  const { stdout } = await gh(["run", "view", String(runId), "--log"], {
    allowFailure: true,
  });
  return parseResultLines(stdout || "");
}

export async function viewRun(gh, runId) {
  const { stdout } = await gh([
    "run",
    "view",
    String(runId),
    "--json",
    "databaseId,status,conclusion,url,headSha,event",
  ]);
  return JSON.parse(stdout);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
