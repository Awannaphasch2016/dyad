// Command surface. Output follows the AXI house style: compact key/value
// blocks, a help[] block with next steps, and `error:`/`code:` on failure.
import { readFileSync } from "node:fs";
import { OPERATIONS, findOperation, DYAD_REPO } from "./catalog.js";
import { GhError, makeGh } from "./gh.js";
import { pollRun, readResults, startRun, waitForRun } from "./run.js";
import { installDigest } from "./toolbox.js";

const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

const FLAG_VALUES = new Set([
  "--ref",
  "--repo",
  "--field",
  "-f",
  "-R",
  "--project",
  "--config",
  "--aws-project",
  "--aws-config",
  "--title",
  "--head",
  "--base",
  "--body",
  "--source-repo",
  "--source-ref",
]);

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
  --ref <branch>         branch whose workflow file and code run (each operation has a default)
  --repo <owner/repo>    repository that owns the workflow (each operation has a default)
  --project <name>       Doppler project. Default is the pair that command uses today
  --config <name>        Doppler config
  --aws-project <name>   second Doppler project, when the command reads two
  --aws-config <name>    second Doppler config
  --field <k=v>          workflow_dispatch input (repeatable, run only)
  --title <text>         pull request title (pr open)
  --head <branch>        branch to open (pr open)
  --base <branch>        base branch (pr open, default main)
  --body <text>          pull request body (pr open)
  --source-repo <o/r>    repository the App fetches the branch from (pr open)
  --source-ref <ref>     ref in --source-repo (pr open)
  --no-wait              start the run and return its URL without waiting
  --json                 print the result as JSON
notes:
  GitHub only dispatches a workflow file that exists on the default branch.
  A refused dispatch fails this command. It does not rerun an older run,
  because that rerun would ignore the arguments from this call.
  A write with no Doppler default exits before it changes anything when
  --project and --config are omitted.
  Result lines are the key=value lines the workflow prints. Values whose key
  looks secret are shown as <redacted>.
  pr open does not merge. cursor factory is not a command. Walk commands are
  added when ui-walk.yml exists.
examples:
  ops-axi ec2 check
  ops-axi doppler status
  ops-axi preview status 177 --project dyad --config dev
  ops-axi rollout 5e952bbc
  ops-axi toolbox use sha256:${"a".repeat(64)}
  ops-axi pr open Awannaphasch2016/forma --title "Add status" --head cursor/status`;

export function parseArgs(argv) {
  const words = [];
  const flags = { fields: [], wait: true, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FLAG_VALUES.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      i += 1;
      if (arg === "--ref") flags.ref = value;
      else if (arg === "--repo" || arg === "-R") flags.repo = value;
      else if (arg === "--project") flags.project = value;
      else if (arg === "--config") flags.config = value;
      else if (arg === "--aws-project") flags.awsProject = value;
      else if (arg === "--aws-config") flags.awsConfig = value;
      else if (arg === "--title") flags.title = value;
      else if (arg === "--head") flags.head = value;
      else if (arg === "--base") flags.base = value;
      else if (arg === "--body") flags.body = value;
      else if (arg === "--source-repo") flags.sourceRepo = value;
      else if (arg === "--source-ref") flags.sourceRef = value;
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

export function applyDoppler(name, op, flags) {
  if (
    op.requiresDoppler &&
    !(op.doppler?.project && op.doppler?.config) &&
    (!flags.project || !flags.config)
  ) {
    throw new UsageError(
      `${name} writes a Doppler config and needs --project and --config`,
    );
  }
  const project = flags.project || op.doppler?.project;
  const config = flags.config || op.doppler?.config;
  const awsProject = flags.awsProject || op.doppler?.awsProject;
  const awsConfig = flags.awsConfig || op.doppler?.awsConfig;
  const fields = [];
  if (project) fields.push(`doppler-project=${project}`);
  if (config) fields.push(`doppler-config=${config}`);
  if (awsProject) fields.push(`aws-project=${awsProject}`);
  if (awsConfig) fields.push(`aws-config=${awsConfig}`);
  return { project, config, awsProject, awsConfig, fields };
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
    const doppler = applyDoppler(`run ${workflow}`, {}, flags);
    return {
      name: `run ${workflow}`,
      kind: "dispatch",
      repo: flags.repo || process.env.GH_REPO || DYAD_REPO,
      workflow,
      ref: flags.ref,
      fields: [...flags.fields, ...doppler.fields],
      verify: [],
      project: doppler.project,
      config: doppler.config,
    };
  }
  const found = findOperation(words);
  if (!found)
    throw new UsageError(`Unknown operation: ${words.join(" ") || "(none)"}`);
  const { name, op, rest } = found;
  const doppler = applyDoppler(name, op, flags);
  const fields = [...(op.fixed || [])];
  let digest;
  let pr;
  if (op.positional) {
    const value = rest[0];
    if (!value || !op.positional.pattern.test(value)) {
      throw new UsageError(
        `${name} needs <${op.positional.name}> matching ${op.positional.pattern}`,
      );
    }
    if (rest.length > 1) {
      throw new UsageError(`${name} takes one positional argument`);
    }
    if (op.kind !== "toolbox-use")
      fields.push(`${op.positional.field}=${value}`);
    if (op.kind === "toolbox-use") digest = value;
    if (op.positional.field === "pr") pr = value;
  } else if (rest.length) {
    throw new UsageError(`${name} takes no positional arguments`);
  }
  if (op.needsTitle) {
    if (!flags.title) throw new UsageError(`${name} needs --title`);
    if (!flags.head) throw new UsageError(`${name} needs --head`);
    fields.push(`title=${flags.title}`);
    fields.push(`head=${flags.head}`);
    fields.push(`base=${flags.base || "main"}`);
    if (flags.body) fields.push(`body=${flags.body}`);
    if (flags.sourceRepo) fields.push(`source-repo=${flags.sourceRepo}`);
    if (flags.sourceRef) fields.push(`source-ref=${flags.sourceRef}`);
  }
  if (op.kind !== "label" && op.kind !== "toolbox-use") {
    fields.push(...doppler.fields);
  }
  return {
    name,
    kind: op.kind || "dispatch",
    labelAction: op.labelAction,
    repo: flags.repo || op.repo,
    workflow: op.workflow,
    ref: flags.ref || op.defaultRef,
    fields,
    verify: op.verify || [],
    project: doppler.project,
    config: doppler.config,
    digest,
    pr,
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
    `  ref: ${started.ref || operation.ref}`,
    `  mode: ${started.mode}`,
  ];
  if (operation.project) lines.push(`  project: ${operation.project}`);
  if (operation.config) lines.push(`  config: ${operation.config}`);
  lines.push(
    `  id: ${started.run.databaseId}`,
    `  url: ${started.run.url}`,
    `  conclusion: ${conclusion}`,
  );
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
  if (error.code === "DISPATCH_REFUSED") {
    help.push(
      "The workflow file has to be on the default branch before a dispatch can start",
    );
    help.push("This command does not rerun an older run");
  }
  if (error.code === "GH_NOT_INSTALLED")
    help.push("Install gh: https://cli.github.com");
  if (help.length) {
    lines.push(`help[${help.length}]:`);
    for (const line of help) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

async function startLabel(gh, operation, io) {
  const flag =
    operation.labelAction === "add" ? "--add-label" : "--remove-label";
  await gh(["pr", "edit", operation.pr, flag, "preview"]);
  const viewed = await gh([
    "pr",
    "view",
    operation.pr,
    "--json",
    "headRefName,url",
  ]);
  const pull = JSON.parse(viewed.stdout);
  const after = (io.now || Date.now)();
  const run = await pollRun(gh, {
    workflow: operation.workflow,
    ref: pull.headRefName,
    after,
    event: "pull_request",
    sleep: io.sleep,
  });
  if (!run) {
    throw new GhError(
      `The preview label changed on pull request ${operation.pr} but preview.yml did not start`,
      { code: "RUN_NOT_FOUND" },
    );
  }
  return { mode: "label", run, ref: pull.headRefName };
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

  if (operation.kind === "toolbox-use") {
    try {
      const installed = await installDigest({
        digest: operation.digest,
        binDir: io.binDir,
        pinPath: io.pinPath,
        docker: io.docker,
      });
      out(
        [
          "toolbox:",
          `  digest: ${installed.digest}`,
          `  image: ${installed.image}`,
          `  bin: ${installed.binDir}`,
          `  pin: ${installed.pinPath}`,
        ].join("\n"),
      );
      return 0;
    } catch (error) {
      err(renderError(error));
      return error.code === "VALIDATION_ERROR" ? 2 : 3;
    }
  }

  const repo = flags.repo || operation.repo;
  const gh = io.gh || makeGh({ repo });
  try {
    const started =
      operation.kind === "label"
        ? await startLabel(gh, operation, io)
        : await startRun(gh, {
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
    if (flags.json) {
      out(
        JSON.stringify({
          operation: operation.name,
          workflow: operation.workflow,
          ref: started.ref || operation.ref,
          mode: started.mode,
          project: operation.project,
          config: operation.config,
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
