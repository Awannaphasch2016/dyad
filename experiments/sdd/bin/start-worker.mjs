#!/usr/bin/env node
// Create the implementation worker with POST /v1/agents and record it in run.json.
// Usage: node start-worker.mjs --run-id <id> [--dry-run]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cursor,
  sh,
  arg,
  readRun,
  writeRun,
  nowIso,
  SDD_ROOT,
  LEAK_MARKERS,
} from "./lib.mjs";

export function buildPrompt(specText, runIdForBranch) {
  return `You are implementing a website from the fixed specification below. Follow these steps in order and do not skip any.

1. Create and switch to a branch named exp/${runIdForBranch}. Save the specification text between the SPEC markers verbatim to SPEC.md at the repository root. Do not edit it afterwards.
2. Run the skill /speckit-specify with the full content of SPEC.md as the feature description.
3. Run /speckit-clarify. You have no human to ask. Resolve every question using the Assumptions section of SPEC.md; when it does not cover a question, choose the simplest option and record the choice in specs/*/spec.md under "Clarifications".
4. Run /speckit-plan with: PHP 8.2 or newer, no framework or any Composer framework of your choice, vanilla CSS, data from the JSON fixtures in SPEC.md shipped as data/program.json and data/fees.json, one Dockerfile serving on port 80 with the official php image, no network access at runtime.
5. Run /speckit-tasks, then /speckit-implement. If the implement skill stops at the checklist gate, continue and list the unchecked items in NOTES.md.
6. Start the site with \`php -S 127.0.0.1:8080 -t <your document root>\` and request every page in SPEC.md with curl, including a POST to /contact with empty fields and one with valid fields. Fix failures.
7. Run /speckit-converge. If it adds tasks, run /speckit-implement again. At most two converge rounds.
8. Commit everything, including specs/, SPEC.md and NOTES.md, push the branch and open a pull request against main.

Do not search the web for the original website or its source. Do not add analytics, CAPTCHA, email, or external services. Do not modify SPEC.md.

<<<SPEC
${specText}
SPEC>>>
`;
}

// A fix run starts from an existing commit. The first-run prompt would tell
// the worker to write SPEC.md again and to treat php -S as proof.
export function buildFollowUpPrompt(runIdForBranch) {
  return `You are fixing an existing website. The repository already contains SPEC.md and the PHP site. Follow these steps in order.

1. Create and switch to a new branch named exp/${runIdForBranch}. Do not commit on the branch that was already open. Open a new pull request against main.
2. Leave SPEC.md byte-identical. Do not search for the live conference site. Do not add analytics, email, or a captcha. Do not fetch any other repository.
3. AC-10 through AC-13 failed. The container log shows POST /contact answered 301, and GET /contact also answered 301 to /contact/. The browser then loaded the empty form, so nothing was validated or stored.
4. The form is posted to /contact. Apache redirects that path before the PHP contact handler runs, because public/contact/ is a directory. php -S does not add that redirect, so a built-in server check is not evidence.
5. Make POST /contact reach the contact handler. Keep the field errors, the confirmation, and GET /contact/submissions.json required by SPEC.md section 4.4.
6. Build the Docker image from the repository Dockerfile and run it. Re-check these requests against that container: an empty POST /contact, a POST with an invalid email, a valid POST, and a second valid POST whose subject then appears in GET /contact/submissions.json. Fix any failure you see there.
7. Commit, push exp/${runIdForBranch}, and open the pull request.

Do not modify SPEC.md.
`;
}

export function promptFor(run, specText, runIdForBranch) {
  const text = run.follow_up
    ? buildFollowUpPrompt(runIdForBranch)
    : buildPrompt(specText, runIdForBranch);
  const hit = LEAK_MARKERS.find((marker) =>
    text.toLowerCase().includes(marker.toLowerCase()),
  );
  if (hit) throw new Error(`prompt contains leak marker ${hit}`);
  return text;
}

export function explicitStartingSha(run) {
  return typeof run.starting_sha === "string" &&
    /^[0-9a-f]{40}$/.test(run.starting_sha)
    ? run.starting_sha
    : null;
}

// The Cloud Agents API accepts a branch name or a commit SHA. A tag name is rejected.
function resolveStartingRef(repo, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const listed = sh("git", [
    "ls-remote",
    `https://github.com/${repo}`,
    `refs/heads/${ref}`,
    `refs/tags/${ref}`,
  ]);
  const lines = listed.split("\n").filter(Boolean);
  const head = lines.find((line) => line.endsWith(`refs/heads/${ref}`));
  const tag = lines.find((line) => line.endsWith(`refs/tags/${ref}`));
  return (head ?? tag ?? "").split(/\s+/)[0] || ref;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (invokedDirectly()) {
  const runId = arg("run-id");
  const dryRun = arg("dry-run", false) === true;
  if (!runId || typeof runId !== "string") {
    console.error("usage: start-worker.mjs --run-id <id> [--dry-run]");
    process.exit(2);
  }
  const run = readRun(runId);
  if (run.worker.agent_id) {
    console.error(`worker already started: ${run.worker.agent_id}`);
    process.exit(1);
  }
  const specDir = join(
    SDD_ROOT,
    "specs",
    ...run.spec_version.replace(/-v(\d+)$/, "/v$1").split("/"),
  );
  const spec = readFileSync(join(specDir, "requirements.md"), "utf8");
  if (run.follow_up && !explicitStartingSha(run)) {
    console.error("follow-up run requires starting_sha");
    process.exit(1);
  }
  const prompt = promptFor(run, spec, runId);
  const startingRef =
    explicitStartingSha(run) ??
    resolveStartingRef(run.impl_repo, run.baseline_ref);
  run.baseline_sha = startingRef;
  const body = {
    prompt: { text: prompt },
    model: { id: run.worker.model },
    repos: [
      {
        url: `https://github.com/${run.impl_repo}`,
        startingRef,
      },
    ],
    autoCreatePR: true,
    skipReviewerRequest: true,
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ...body,
          prompt: {
            text: `${prompt.slice(0, 400)}... (${prompt.length} chars)`,
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // Response shape per https://cursor.com/docs/cloud-agent/api/endpoints: { agent: {...}, run: {...} }
  const created = await cursor("/v1/agents", { method: "POST", body });
  const agent = created.agent ?? created;
  const workerRun = created.run ?? {};
  run.worker.agent_id = agent.id;
  run.worker.run_id = workerRun.id ?? agent.latestRunId ?? null;
  run.worker.created_at = workerRun.createdAt ?? agent.createdAt ?? nowIso();
  run.worker.status = workerRun.status ?? "CREATING";
  run.worker.url = agent.url ?? null;
  run.worker.prompt_chars = prompt.length;
  writeRun(runId, run);
  console.log(
    `worker ${agent.id} (run ${run.worker.run_id}) created on ${run.impl_repo}@${startingRef}`,
  );
}
