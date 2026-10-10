#!/usr/bin/env node
// Poll the worker run until it reaches a terminal state or the wall-clock cap,
// save its SSE stream to results/worker-stream.jsonl, and record the pull
// request in run.json. Cancels the run at the cap.
// Usage: node watch-worker.mjs --run-id <id> [--interval 30]
import {
  createWriteStream,
  existsSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  cursor,
  arg,
  readRun,
  writeRun,
  nowIso,
  sleep,
  runDir,
  sh,
  LEAK_MARKERS,
  CURSOR_API,
  apiKey,
} from "./lib.mjs";

const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
const runId = arg("run-id");
const interval = Number(arg("interval", 30)) * 1000;
if (!runId || typeof runId !== "string") {
  console.error("usage: watch-worker.mjs --run-id <id> [--interval 30]");
  process.exit(2);
}
const run = readRun(runId);
const { agent_id: agentId, run_id: workerRunId } = run.worker;
if (!agentId || !workerRunId) {
  console.error("worker not started; run start-worker.mjs first");
  process.exit(1);
}
const resultsDir = join(runDir(runId), "results");
mkdirSync(resultsDir, { recursive: true });
const streamPath = join(resultsDir, "worker-stream.jsonl");
const deadline =
  Date.parse(run.worker.created_at) + run.caps.wall_clock_minutes * 60_000;

// Stream in the background; reconnect while the run is live.
let streamText = "";
let streaming = true;
async function streamLoop() {
  const out = createWriteStream(streamPath, { flags: "a" });
  while (streaming) {
    try {
      const res = await fetch(
        `${CURSOR_API}/v1/agents/${agentId}/runs/${workerRunId}/stream`,
        {
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${apiKey()}:`).toString("base64"),
            Accept: "text/event-stream",
          },
        },
      );
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = block.match(/^event: (.*)$/m)?.[1] ?? "message";
          const data = block.match(/^data: (.*)$/m)?.[1] ?? "";
          out.write(JSON.stringify({ at: nowIso(), event, data }) + "\n");
          streamText += `${data}\n`;
          if (event === "done") return;
        }
      }
    } catch (err) {
      if (!streaming) return;
      out.write(
        JSON.stringify({
          at: nowIso(),
          event: "stream_error",
          data: String(err.message),
        }) + "\n",
      );
      await sleep(5000);
    }
  }
}
const streamPromise = streamLoop();

let last = null;
let polls = 0;
while (true) {
  try {
    last = await cursor(`/v1/agents/${agentId}/runs/${workerRunId}`);
    polls++;
    run.worker.status = last.status;
    if (polls % 4 === 1) console.log(`${nowIso()} ${last.status}`);
    if (TERMINAL.has(last.status)) break;
  } catch (err) {
    console.log(`${nowIso()} poll failed: ${err.message}`);
  }
  if (Date.now() > deadline) {
    console.log(
      `wall-clock cap of ${run.caps.wall_clock_minutes} min reached; cancelling`,
    );
    try {
      await cursor(`/v1/agents/${agentId}/runs/${workerRunId}/cancel`, {
        method: "POST",
      });
    } catch (err) {
      console.log(`cancel failed: ${err.message}`);
    }
    run.worker.status = "CANCELLED";
    run.worker.cancelled_reason = "wall_clock_cap";
    run.interventions.push({
      at: nowIso(),
      by: "coordinator",
      action: "cancel",
      reason: "wall_clock_cap",
      automated: true,
    });
    break;
  }
  writeRun(runId, run);
  await sleep(interval);
}
streaming = false;
await Promise.race([streamPromise, sleep(3000)]);

run.worker.finished_at = last?.updatedAt ?? nowIso();
run.worker.duration_ms =
  last?.durationMs ??
  Date.parse(run.worker.finished_at) - Date.parse(run.worker.created_at);
run.worker.result = last?.result ?? null;

// Pull request: from the run record, else from GitHub.
const branch =
  last?.git?.branches?.find((b) => b.prUrl) ?? last?.git?.branches?.[0];
if (branch?.prUrl) {
  run.pr.url = branch.prUrl;
  run.pr.number = Number(branch.prUrl.split("/").pop());
  run.pr.branch = branch.branch;
} else {
  try {
    const prs = JSON.parse(
      sh("gh", [
        "pr",
        "list",
        "-R",
        run.impl_repo,
        "--state",
        "all",
        "--json",
        "number,url,headRefName,headRefOid",
        "--search",
        `head:exp/${runId}`,
      ]),
    );
    if (prs[0])
      Object.assign(run.pr, {
        url: prs[0].url,
        number: prs[0].number,
        branch: prs[0].headRefName,
        head_sha: prs[0].headRefOid,
      });
  } catch (err) {
    console.log(`gh pr list failed: ${err.message.split("\n")[0]}`);
  }
}
if (run.pr.number && !run.pr.head_sha) {
  try {
    run.pr.head_sha = JSON.parse(
      sh("gh", [
        "pr",
        "view",
        String(run.pr.number),
        "-R",
        run.impl_repo,
        "--json",
        "headRefOid",
      ]),
    ).headRefOid;
  } catch (err) {
    console.log(`gh pr view failed: ${err.message.split("\n")[0]}`);
  }
}
if (!run.pr.head_sha && run.pr.branch) {
  try {
    run.pr.head_sha =
      sh("git", [
        "ls-remote",
        `https://github.com/${run.impl_repo}`,
        `refs/heads/${run.pr.branch}`,
      ]).split(/\s+/)[0] || null;
  } catch {
    // leave null; the verifier cannot run without it
  }
}

// Iteration counts and leak markers from the stream text.
const text = existsSync(streamPath)
  ? readFileSync(streamPath, "utf8")
  : streamText;
const count = (re) => (text.match(re) ?? []).length;
run.iterations = {
  implement_rounds: Math.max(
    1,
    count(/speckit-implement/g) > 0
      ? Math.ceil(count(/speckit-implement/g) / 2)
      : 0,
  ),
  converge_rounds: Math.ceil(count(/speckit-converge/g) / 2),
  follow_up_runs: 0,
  raw_mentions: {
    implement: count(/speckit-implement/g),
    converge: count(/speckit-converge/g),
    clarify: count(/speckit-clarify/g),
  },
};
run.isolation.leak_markers = LEAK_MARKERS.filter(
  (m) =>
    text.toLowerCase().includes(m.toLowerCase()) && m !== "experiments/sdd",
);
writeRun(runId, run);
console.log(
  `worker ${run.worker.status} after ${Math.round(run.worker.duration_ms / 60000)} min; PR ${run.pr.url ?? "none"} head ${run.pr.head_sha ?? "unknown"}; leak markers ${run.isolation.leak_markers.length}`,
);
