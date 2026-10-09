#!/usr/bin/env node
// Read token usage for the worker (and the coordinator when its agent id is
// known), price it with pricing.json, and read the verifier job duration.
// Every USD figure is an estimate from pinned list prices; tokens are measured.
// Usage: node collect-usage.mjs --run-id <id> [--verifier-run <actions run id>]
import { join } from "node:path";
import {
  cursor,
  arg,
  readRun,
  runDir,
  readJson,
  writeJson,
  sh,
  SDD_ROOT,
} from "./lib.mjs";

const runId = arg("run-id");
const verifierRun = arg("verifier-run");
if (!runId || typeof runId !== "string") {
  console.error("usage: collect-usage.mjs --run-id <id> [--verifier-run <id>]");
  process.exit(2);
}
const run = readRun(runId);
const pricing = readJson(join(SDD_ROOT, "pricing.json"), {});

export function priceTokens(tokens, price) {
  if (!tokens || !price) return null;
  const perM = (n, rate) => ((n ?? 0) / 1_000_000) * (rate ?? 0);
  return +(
    perM(tokens.inputTokens, price.input_per_m) +
    perM(tokens.outputTokens, price.output_per_m) +
    perM(tokens.cacheReadTokens, price.cache_read_per_m) +
    perM(tokens.cacheWriteTokens, price.cache_write_per_m)
  ).toFixed(4);
}

async function usageFor(agentId, onlyRunId) {
  if (!agentId) return null;
  const usage = await cursor(`/v1/agents/${agentId}/usage`);
  if (onlyRunId) {
    const match = (usage.runs ?? []).find((r) => r.id === onlyRunId);
    if (match) return match.usage;
  }
  return usage.totalUsage ?? null;
}

const out = {
  worker_tokens: await usageFor(run.worker.agent_id, run.worker.run_id).catch(
    (err) => ({ error: err.message }),
  ),
  coordinator_tokens: await usageFor(run.coordinator.agent_id).catch((err) => ({
    error: err.message,
  })),
  pricing_source: "experiments/sdd/pricing.json",
  pricing_pinned: pricing[run.worker.model]?.pinned ?? null,
  note: "USD figures are estimates from pinned list prices; tokens are measured",
};
out.worker_usd_estimate =
  out.worker_tokens && !out.worker_tokens.error
    ? priceTokens(out.worker_tokens, pricing[run.worker.model])
    : null;
out.coordinator_usd_estimate =
  out.coordinator_tokens && !out.coordinator_tokens.error
    ? priceTokens(
        out.coordinator_tokens,
        pricing[process.env.CURSOR_COORDINATOR_MODEL ?? run.worker.model],
      )
    : null;
if (
  out.worker_usd_estimate == null &&
  out.worker_tokens &&
  !out.worker_tokens.error
)
  out.note += `; no pricing entry for ${run.worker.model}`;

if (verifierRun && typeof verifierRun === "string") {
  try {
    const view = JSON.parse(
      sh("gh", [
        "run",
        "view",
        verifierRun,
        "-R",
        process.env.GITHUB_REPOSITORY ?? "Awannaphasch2016/dyad",
        "--json",
        "jobs,url,conclusion",
      ]),
    );
    const seconds = (view.jobs ?? []).reduce(
      (acc, j) =>
        acc +
        (j.completedAt && j.startedAt
          ? (Date.parse(j.completedAt) - Date.parse(j.startedAt)) / 1000
          : 0),
      0,
    );
    out.actions_minutes = +(seconds / 60).toFixed(2);
    out.verifier = { run_url: view.url, conclusion: view.conclusion, seconds };
  } catch (err) {
    out.verifier = { error: err.message.split("\n")[0] };
  }
}

writeJson(join(runDir(runId), "results", "usage.json"), out);
console.log(JSON.stringify(out, null, 2));
