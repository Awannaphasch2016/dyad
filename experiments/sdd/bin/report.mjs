#!/usr/bin/env node
// Merge run.json, the verifier's results.partial.json, cloc.json and usage.json
// into results/results.json (validated against schema/results.schema.json)
// and results/report.md.
// Usage: node report.mjs --run-id <id> [--evidence <dir downloaded from the artifact>]
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  arg,
  readRun,
  writeRun,
  runDir,
  readJson,
  writeJson,
  nowIso,
  SDD_ROOT,
} from "./lib.mjs";

const runId = arg("run-id");
if (!runId || typeof runId !== "string") {
  console.error("usage: report.mjs --run-id <id> [--evidence <dir>]");
  process.exit(2);
}
const run = readRun(runId);
const dir = runDir(runId);
const evidenceDir =
  typeof arg("evidence") === "string" ? arg("evidence") : join(dir, "evidence");
const partial = readJson(join(evidenceDir, "results.partial.json"));
const cloc = readJson(join(evidenceDir, "cloc.json"), {});
const build = readJson(join(evidenceDir, "build.json"), {});
const usage = readJson(join(dir, "results", "usage.json"), {});

if (!partial) {
  console.error(
    `no results.partial.json under ${evidenceDir}; download the verifier artifact first`,
  );
  process.exit(1);
}

const lines = (lang) => cloc?.[lang]?.code ?? 0;
const specModified = build.spec_check && build.spec_check !== "match";
const contaminated =
  run.isolation.leak_markers.length > 0 ||
  partial.acceptance.some((a) => a.id === "AC-20" && a.status === "failed");
let finalStatus;
if (contaminated) finalStatus = "contaminated";
else if (!run.pr.head_sha || run.worker.status !== "FINISHED")
  finalStatus = "blocked";
else if (partial.verification_pass_rate.ratio === 1 && !specModified)
  finalStatus = "completed";
else finalStatus = "partially_completed";

const workerSeconds = Math.round((run.worker.duration_ms ?? 0) / 1000);
const verifierSeconds = Math.round(usage.verifier?.seconds ?? 0);
const results = {
  run_id: runId,
  approach: run.approach,
  approach_version: run.approach_version,
  spec_version: run.spec_version,
  spec_sha256: run.spec_sha256,
  spec_unchanged_by_worker: build.spec_check === "match",
  final_status: finalStatus,
  spec_coverage: partial.spec_coverage,
  acceptance: partial.acceptance,
  verification_pass_rate: partial.verification_pass_rate,
  ui_verification: partial.ui_verification,
  build: {
    docker_build: build.docker_build ?? "unknown",
    container_healthy: !!build.container_healthy,
    build_seconds: build.build_seconds ?? null,
    network_none_status: build.network_none_status ?? null,
  },
  execution_time: {
    worker_seconds: workerSeconds,
    verifier_seconds: verifierSeconds,
    total_seconds: workerSeconds + verifierSeconds,
    started_at: run.worker.created_at,
    verified_at: nowIso(),
  },
  cost: {
    worker_tokens: usage.worker_tokens ?? {},
    worker_usd_estimate: usage.worker_usd_estimate ?? null,
    coordinator_tokens: usage.coordinator_tokens ?? {},
    coordinator_usd_estimate: usage.coordinator_usd_estimate ?? null,
    actions_minutes: usage.actions_minutes ?? null,
    pricing_source: "experiments/sdd/pricing.json",
    note:
      usage.note ??
      "USD figures are estimates from pinned list prices; tokens are measured",
  },
  human_intervention: {
    count: run.interventions.filter((i) => !i.automated).length,
    actions: run.interventions,
  },
  source_lines: {
    tool: cloc?.header?.cloc_version
      ? `cloc ${cloc.header.cloc_version}`
      : "cloc",
    php: lines("PHP"),
    html: lines("HTML") + lines("PHP/HTML") + lines("Blade"),
    css: lines("CSS"),
    js: lines("JavaScript"),
    total_code: cloc?.SUM?.code ?? 0,
    excluded: [
      "vendor",
      "node_modules",
      ".specify",
      ".cursor",
      "specs",
      "data",
      "*.lock",
      "*.min.*",
      "JSON",
      "YAML",
      "Markdown",
      "Text",
      "SVG",
      "XML",
    ],
  },
  iterations: run.iterations ?? {
    implement_rounds: 0,
    converge_rounds: 0,
    follow_up_runs: 0,
  },
  isolation: run.isolation,
  worker: {
    agent_id: run.worker.agent_id,
    run_id: run.worker.run_id,
    model: run.worker.model,
    status: run.worker.status,
    url: run.worker.url ?? null,
  },
  pr: run.pr,
  verifier: {
    run_url: usage.verifier?.run_url ?? null,
    artifact: `sdd-${runId}-evidence`,
  },
};

// Light schema validation without a dependency: required keys and types.
const schema = readJson(join(SDD_ROOT, "schema", "results.schema.json"));
const missing = (schema?.required ?? []).filter((k) => !(k in results));
if (missing.length) {
  console.error(`results.json is missing required keys: ${missing.join(", ")}`);
  process.exit(1);
}
if (!schema.properties.final_status.enum.includes(results.final_status)) {
  console.error(`invalid final_status ${results.final_status}`);
  process.exit(1);
}

writeJson(join(dir, "results", "results.json"), results);

const icon = (s) =>
  ({
    passed: "pass",
    failed: "FAIL",
    not_measurable: "n/m",
    not_run: "not run",
  })[s] ?? s;
const md = [
  `# Run ${runId}`,
  "",
  `Final status: **${finalStatus}**. Approach ${run.approach} ${run.approach_version}, spec ${run.spec_version} (${run.spec_sha256.slice(0, 12)}), worker model ${run.worker.model}.`,
  "",
  `- Spec coverage: ${partial.spec_coverage.implemented}/${partial.spec_coverage.total} FRs (${partial.spec_coverage.implemented_frs?.join(", ") || "none"})`,
  `- Verification pass rate: ${partial.verification_pass_rate.passed}/${partial.verification_pass_rate.total}, ${partial.verification_pass_rate.not_measurable} not measurable`,
  `- Build: docker build ${results.build.docker_build}, container healthy ${results.build.container_healthy}, no-network GET / ${results.build.network_none_status ?? "n/a"}`,
  `- Worker: ${run.worker.status} in ${Math.round(workerSeconds / 60)} min, ${results.iterations.implement_rounds} implement round(s), ${results.iterations.converge_rounds} converge round(s)`,
  `- Tokens: ${results.cost.worker_tokens.totalTokens ?? "unknown"} total; estimated USD ${results.cost.worker_usd_estimate ?? "unknown"} (list prices, estimate)`,
  `- Human interventions: ${results.human_intervention.count}`,
  `- Source lines (cloc, exclusions listed in results.json): PHP ${results.source_lines.php}, HTML ${results.source_lines.html}, CSS ${results.source_lines.css}, JS ${results.source_lines.js}`,
  `- Isolation: ground truth listed ${run.isolation.ground_truth_listed}, leak markers ${run.isolation.leak_markers.length}; SPEC.md unchanged ${results.spec_unchanged_by_worker}`,
  `- Pull request: ${run.pr.url ?? "none"} at ${run.pr.head_sha ?? "unknown"}`,
  `- Verifier: ${results.verifier.run_url ?? "unknown"}, artifact ${results.verifier.artifact}`,
  "",
  "## Acceptance",
  "",
  "| AC | FR | Status | Expected | Actual | Evidence |",
  "| --- | --- | --- | --- | --- | --- |",
  ...partial.acceptance.map(
    (a) =>
      `| ${a.id} | ${a.fr.join(", ")} | ${icon(a.status)} | ${a.expected.replace(/\|/g, "\\|")} | ${String(a.actual).replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${a.evidence.join(", ")} |`,
  ),
  "",
  "## Screenshots",
  "",
  ...(results.ui_verification.screenshots ?? []).map((s) => `- ${s}`),
  "",
];
writeFileSync(join(dir, "results", "report.md"), md.join("\n"));
run.final_status = finalStatus;
writeRun(runId, run);
console.log(
  `results/results.json and results/report.md written; final status ${finalStatus}`,
);
