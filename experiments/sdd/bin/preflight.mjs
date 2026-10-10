#!/usr/bin/env node
// Check everything a worker run depends on and write a draft run.json.
// Usage: node preflight.mjs --run-id <id> --model <model id> [--impl-repo owner/name]
//        [--baseline baseline/speckit-1.1.2] [--spec gitcon-v1] [--wall-clock 90] [--usd-cap 25]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cursor, sh, arg, writeRun, nowIso, sleep, SDD_ROOT } from "./lib.mjs";
import { specSha256, renderSpec } from "./build-spec.mjs";
import { readFileSync } from "node:fs";

const GROUND_TRUTH = ["Wewebplus/dev25-git-con", "dev25-git-con"];

const runId = arg("run-id");
const model = arg("model");
const implRepo = arg("impl-repo", "Awannaphasch2016/sdd-gitcon-impl");
const baseline = arg("baseline", "baseline/speckit-1.1.2");
const specVersion = arg("spec", "gitcon-v1");
const wallClock = Number(arg("wall-clock", 90));
const usdCap = Number(arg("usd-cap", 25));
const followUp = arg("follow-up", false) === true;
const startingSha = arg("starting-sha", "");
const parentRun = arg("parent-run", "");
if (
  !runId ||
  typeof runId !== "string" ||
  !model ||
  typeof model !== "string"
) {
  console.error(
    "usage: preflight.mjs --run-id <id> --model <model id> [--impl-repo owner/name]",
  );
  process.exit(2);
}

const failures = [];
const note = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};

// 1. Specification is rendered and pinned.
const specDir = join(
  SDD_ROOT,
  "specs",
  ...specVersion.replace(/-v(\d+)$/, "/v$1").split("/"),
);
const rendered = renderSpec(specDir);
const current = existsSync(join(specDir, "requirements.md"))
  ? readFileSync(join(specDir, "requirements.md"), "utf8")
  : "";
note(
  rendered === current,
  `requirements.md matches template and fixtures (${specDir})`,
);
const specSha = specSha256(specDir);
console.log(`     spec sha256 ${specSha}`);

// 2. Cursor API key and account.
let me = null;
try {
  me = await cursor("/v1/me");
  note(
    true,
    `GET /v1/me as ${me.userEmail ?? me.email ?? "unknown"} (${me.apiKeyName ?? "key"})`,
  );
} catch (err) {
  note(false, `GET /v1/me failed: ${err.message}`);
}

// 3. Model exists.
try {
  const models = await cursor("/v1/models");
  const listed = models.items ?? models.models ?? models;
  const ids = (Array.isArray(listed) ? listed : []).map((m) =>
    typeof m === "string" ? m : m.id,
  );
  note(
    ids.includes(model),
    `model ${model} is in GET /v1/models (${ids.length} models)`,
  );
} catch (err) {
  note(false, `GET /v1/models failed: ${err.message}`);
}

// 4. Repositories: implementation present, ground truth absent.
let groundTruthListed = null;
try {
  let repos;
  try {
    repos = await cursor("/v1/repositories");
  } catch (err) {
    if (err.status !== 429) throw err;
    console.log("repository list is rate limited; waiting 60s");
    await sleep(60_000);
    repos = await cursor("/v1/repositories");
  }
  const urls = (repos.items ?? repos.repositories ?? [])
    .map((r) => (typeof r === "string" ? r : (r.repository ?? r.url ?? "")))
    .map((u) =>
      u.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""),
    );
  note(
    urls.includes(implRepo),
    `implementation repository ${implRepo} is accessible to the key (${urls.length} repositories)`,
  );
  groundTruthListed = urls.some((u) =>
    GROUND_TRUTH.some((g) => u.toLowerCase().endsWith(g.toLowerCase())),
  );
  note(
    !groundTruthListed,
    "ground-truth repository is not accessible to the key",
  );
} catch (err) {
  note(false, `GET /v1/repositories failed: ${err.message}`);
}

// 5. Baseline tag exists on the implementation repository.
try {
  const tags = sh("git", [
    "ls-remote",
    "--tags",
    `https://github.com/${implRepo}`,
  ]);
  note(
    tags.includes(`refs/tags/${baseline}`),
    `tag ${baseline} exists on ${implRepo}`,
  );
} catch (err) {
  note(
    false,
    `git ls-remote ${implRepo} failed: ${err.message.split("\n")[0]}`,
  );
}

// 6. Run directory is new.
note(
  !existsSync(join(SDD_ROOT, "runs", runId, "run.json")),
  `runs/${runId}/run.json does not exist yet`,
);

// 7. A fix run names the commit it starts from.
if (followUp) {
  note(
    typeof startingSha === "string" && /^[0-9a-f]{40}$/.test(startingSha),
    `starting commit ${startingSha || "(missing)"} is a 40-character sha`,
  );
}

if (failures.length) {
  console.error(
    `\n${failures.length} preflight failure(s); run.json not written`,
  );
  process.exit(1);
}

writeRun(runId, {
  run_id: runId,
  approach: "speckit",
  approach_version: baseline.split("-").pop(),
  spec_version: specVersion,
  spec_sha256: specSha,
  impl_repo: implRepo,
  baseline_ref: baseline,
  worker: {
    agent_id: null,
    run_id: null,
    model,
    created_at: null,
    finished_at: null,
    status: "NOT_STARTED",
  },
  coordinator: {
    agent_id: process.env.CURSOR_AGENT_ID ?? null,
    started_at: nowIso(),
  },
  pr: { number: null, head_sha: null, url: null },
  isolation: { ground_truth_listed: groundTruthListed, leak_markers: [] },
  interventions: [],
  caps: { wall_clock_minutes: wallClock, estimated_usd: usdCap },
  ...(followUp
    ? {
        follow_up: true,
        starting_sha: startingSha,
        parent_run_id: parentRun || null,
      }
    : {}),
});
console.log(`\nwrote runs/${runId}/run.json`);
