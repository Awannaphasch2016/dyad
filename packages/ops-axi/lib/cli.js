// Command surface. Output follows the AXI house style: compact key/value
// blocks, a help[] block with next steps, and `error:`/`code:` on failure.
import { readFileSync } from "node:fs";
import { DEFAULT_REPO, OPERATIONS, findOperation } from "./catalog.js";
import { GhError, makeGh } from "./gh.js";
import { readResults, startRun, waitForRun } from "./run.js";

const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export const HELP = `usage: ops-axi <operation> [flags]
operations[${Object.keys(OPERATIONS).length + 1}]:
${Object.entries(OPERATIONS)
  .map(
    ([name, op]) =>
      `  ${name}${op.positional ? ` <${op.positional.name}>` : ""} - ${op.summary}`,
  )
  .join("\n")}
  run <workflow.yml> - start any workflow file that declares workflow_dispatch
flags:
  --ref <branch>      branch whose workflow file and code run (each operation has a default)
  --repo <owner/repo> repository (default ${DEFAULT_REPO}, or GH_REPO)
  --field <k=v>       workflow_dispatch input (repeatable, run only)
  --no-wait           start the run and return its URL without waiting
  --json              print the result as JSON
notes:
  GitHub only dispatches workflow files that exist on the default branch. When
  it refuses, ops-axi reruns the latest run of that workflow on --ref instead
  and says so with mode: rerun. A rerun uses that run's commit, not the branch tip.
  Result lines are the key=value lines the workflow prints. Values whose key
  looks secret are shown as <redacted>.
examples:
  ops-axi ec2 check
  ops-axi formula role
  ops-axi formula verify
  ops-axi formula deploy
  ops-axi doppler status
  ops-axi rollout 5e952bbc
  ops-axi run preview-wake.yml --ref cursor/preview-wake-34-bbea`;

export function parseArgs(argv) {
  const words = [];
  const flags = { fields: [], wait: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === "--ref" ||
      arg === "--repo" ||
      arg === "--field" ||
      arg === "-f" ||
      arg === "-R"
    ) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      i += 1;
      if (arg === "--ref") flags.ref = value;
      else if (arg === "--repo" || arg === "-R") flags.repo = value;
      else flags.fields.push(value);
    } else if (arg === "--no-wait") flags.wait = false;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--version" || arg === "-v") flags.version = true;
    else if (arg.startsWith("--")) throw new UsageError(`Unknown flag ${arg}`);
    else words.push(arg);
  }
  return { words, flags };
}

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.code = "VALIDATION_ERROR";
  }
}

export function resolve(words, flags) {
  if (words[0] === "run") {
    const workflow = words[1];
    if (!workflow || !/^[A-Za-z0-9._-]+\.ya?ml$/.test(workflow)) {
      throw new UsageError(
        "run needs a workflow file name such as preview-wake.yml",
      );
    }
    if (!flags.ref) throw new UsageError("run needs --ref <branch>");
    return {
      name: `run ${workflow}`,
      workflow,
      ref: flags.ref,
      fields: flags.fields,
      verify: [],
    };
  }
  const found = findOperation(words);
  if (!found)
    throw new UsageError(`Unknown operation: ${words.join(" ") || "(none)"}`);
  const { name, op, rest } = found;
  const fields = [...flags.fields];
  if (op.positional) {
    const value = rest[0];
    if (!value || !op.positional.pattern.test(value)) {
      throw new UsageError(
        `${name} needs <${op.positional.name}> matching ${op.positional.pattern}`,
      );
    }
    fields.push(`${op.positional.field}=${value}`);
  } else if (rest.length) {
    throw new UsageError(`${name} takes no positional arguments`);
  }
  return {
    name,
    workflow: op.workflow,
    ref: flags.ref || op.defaultRef,
    fields,
    verify: op.verify,
  };
}

export function checkVerify(verify, results) {
  const failures = [];
  for (const { key, expect } of verify) {
    const value = results.get(key);
    if (value === undefined) failures.push(`${key} was not printed`);
    else if (
      expect instanceof RegExp ? !expect.test(value) : value !== expect
    ) {
      failures.push(`${key}=${value}, expected ${expect}`);
    }
  }
  return failures;
}

export function render({
  operation,
  started,
  conclusion,
  results,
  failures,
  help,
}) {
  const lines = [
    "run:",
    `  operation: ${operation.name}`,
    `  workflow: ${operation.workflow}`,
    `  ref: ${operation.ref}`,
    `  mode: ${started.mode}`,
    `  id: ${started.run.databaseId}`,
    `  url: ${started.run.url}`,
  ];
  if (started.reason) lines.push(`  dispatch_refused: ${started.reason}`);
  if (started.mode === "rerun" || started.mode === "attach") {
    lines.push(`  commit: ${String(started.run.headSha || "").slice(0, 8)}`);
  }
  lines.push(`  conclusion: ${conclusion}`);
  if (results && results.size) {
    lines.push(`results[${results.size}]:`);
    for (const [key, value] of results) lines.push(`  ${key}: ${value}`);
  }
  if (failures?.length) {
    lines.push(`verify_failed[${failures.length}]:`);
    for (const failure of failures) lines.push(`  ${failure}`);
  }
  if (help?.length) {
    lines.push(`help[${help.length}]:`);
    for (const line of help) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

export function renderError(error) {
  const lines = [
    `error: ${error.message.split("\n")[0]}`,
    `code: ${error.code || "UNKNOWN"}`,
  ];
  const help = [];
  if (error.code === "AUTH_REQUIRED")
    help.push("Set GH_TOKEN or run `gh auth login`");
  if (error.code === "VALIDATION_ERROR") help.push("Run `ops-axi --help`");
  if (error.code === "FORBIDDEN")
    help.push(
      "Starting a run needs a token with actions: write on this repository; a read-only token can only watch runs",
    );
  if (error.code === "NO_RUN_TO_RERUN") {
    help.push(
      "Push the branch once so a run exists, or merge the workflow file to the default branch",
    );
  }
  if (error.code === "GH_NOT_INSTALLED")
    help.push("Install gh: https://cli.github.com");
  if (help.length) {
    lines.push(`help[${help.length}]:`);
    for (const line of help) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

export async function main(argv, io = {}) {
  const out = io.stdout || ((text) => process.stdout.write(`${text}\n`));
  const err = io.stderr || ((text) => process.stderr.write(`${text}\n`));
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    err(renderError(error));
    return 2;
  }
  const { words, flags } = parsed;
  if (flags.version) {
    out(VERSION);
    return 0;
  }
  if (flags.help || words.length === 0) {
    out(HELP);
    return 0;
  }

  let operation;
  try {
    operation = resolve(words, flags);
  } catch (error) {
    err(renderError(error));
    return 2;
  }

  const repo = flags.repo || process.env.GH_REPO || DEFAULT_REPO;
  const gh = io.gh || makeGh({ repo });
  try {
    const started = await startRun(gh, {
      workflow: operation.workflow,
      ref: operation.ref,
      fields: operation.fields,
      sleep: io.sleep,
      now: io.now,
    });
    if (!flags.wait) {
      out(
        render({
          operation,
          started,
          conclusion: started.run.status || "queued",
          help: [`Watch: gh run watch ${started.run.databaseId} -R ${repo}`],
        }),
      );
      return 0;
    }
    const conclusion = await waitForRun(gh, started.run.databaseId, {
      interval: io.interval,
    });
    const results = await readResults(gh, started.run.databaseId);
    const failures = checkVerify(operation.verify, results);
    const help = [];
    if (conclusion !== "success") {
      help.push(
        `Logs: gh run view ${started.run.databaseId} --log-failed -R ${repo}`,
      );
    }
    if (started.mode === "rerun") {
      help.push(
        "Dispatch was refused; merge the workflow file to the default branch to run the branch tip",
      );
    }
    if (flags.json) {
      out(
        JSON.stringify({
          operation: operation.name,
          workflow: operation.workflow,
          ref: operation.ref,
          mode: started.mode,
          id: started.run.databaseId,
          url: started.run.url,
          conclusion,
          results: Object.fromEntries(results),
          verify_failed: failures,
        }),
      );
    } else {
      out(render({ operation, started, conclusion, results, failures, help }));
    }
    return conclusion === "success" && failures.length === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof GhError || error instanceof UsageError) {
      err(renderError(error));
      return error.code === "VALIDATION_ERROR" ? 2 : 3;
    }
    throw error;
  }
}
