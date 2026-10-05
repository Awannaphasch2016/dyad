import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError, installSessionStartHooks, runAxiCli } from "axi-sdk-js";
import {
  BIN,
  DEFAULT_REF,
  DEFAULT_REPO,
  LOG_LIMIT,
  RERUN_URL,
} from "./constants.js";
import { COMMAND_HELP, TOP_LEVEL_HELP } from "./help.js";
import {
  defaultExec,
  defaultStateDir,
  probePreview,
  readSavedPreviews,
  repoHasResumeScript,
  tokenFileExists,
} from "./io.js";
import {
  commandPlan,
  decideDeploy,
  decideDestroy,
  decideResume,
  failureFromExec,
  nextSteps,
  parseRepo,
  parseResult,
  publicRow,
  resolvePr,
  secretStatus,
  selectTransport,
  withFields,
} from "./plan.js";
import { parseArgs, unknownFlagError } from "./parse.js";
import { redact } from "./redact.js";
import { VERSION } from "./version.js";

const SPECS = {
  status: { pr: "string", repo: "string", ref: "string", fields: "string" },
  inspect: { pr: "string", repo: "string", ref: "string" },
  verify: { pr: "string", repo: "string", ref: "string" },
  logs: { pr: "string", repo: "string", ref: "string", full: "boolean" },
  resume: { pr: "string", repo: "string", ref: "string" },
  deploy: { pr: "string", repo: "string", ref: "string" },
  destroy: { pr: "string", repo: "string", ref: "string", yes: "boolean" },
  db: { pr: "string", repo: "string", ref: "string" },
  env: {},
  run: { repo: "string", ref: "string" },
  setup: {},
};

function raise(error) {
  throw new AxiError(error.message, error.code, error.suggestions ?? []);
}

function checked(args, command) {
  const spec = SPECS[command];
  const parsed = parseArgs(args, spec);
  const unknown = unknownFlagError(parsed.unknown, spec);
  if (unknown) raise(unknown);
  return parsed;
}

function createRuntime(options) {
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  return {
    env,
    exec,
    fetch: options.fetch ?? globalThis.fetch,
    transport:
      options.transport ??
      selectTransport({
        env,
        repoHasScripts: repoHasResumeScript(env.PREVIEW_REPO),
        tokenFileExists: tokenFileExists(env),
      }),
    context: options.context,
    imagePublished: options.imagePublished,
    savedPreviews: options.savedPreviews,
    openPrs: options.openPrs,
    installHooks: options.installHooks ?? installSessionStartHooks,
    rerunUrl: env.PREVIEW_RERUN_URL || RERUN_URL,
    repoRoot: env.PREVIEW_REPO || "",
  };
}

function savedRows(runtime) {
  if (runtime.savedPreviews) return runtime.savedPreviews();
  return readSavedPreviews(defaultStateDir(runtime.env));
}

function savedFor(runtime, pr) {
  return savedRows(runtime).find((row) => String(row.pr) === String(pr));
}

async function loadContext(runtime, flags) {
  if (runtime.context) {
    return {
      repo: flags.repo || runtime.context.repo || DEFAULT_REPO,
      branch: flags.ref || runtime.context.branch || DEFAULT_REF,
      sha: runtime.context.sha || "",
    };
  }
  const remote = runtime.exec("git", ["remote", "get-url", "origin"], {
    cwd: runtime.repoRoot || undefined,
  });
  const branch = runtime.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: runtime.repoRoot || undefined,
  });
  const sha = runtime.exec("git", ["rev-parse", "HEAD"], {
    cwd: runtime.repoRoot || undefined,
  });
  const head = (branch.stdout || "").trim();
  return {
    repo: flags.repo || parseRepo(remote.stdout || "") || DEFAULT_REPO,
    branch: flags.ref || (head && head !== "HEAD" ? head : DEFAULT_REF),
    sha: (sha.stdout || "").trim(),
  };
}

async function lookupPrs(runtime, context) {
  if (runtime.openPrs) return runtime.openPrs(context);
  if (!context.repo || !context.branch) return { prs: [] };
  const result = runtime.exec(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      context.repo,
      "--head",
      context.branch,
      "--state",
      "open",
      "--json",
      "number",
    ],
    {},
  );
  if (result.status !== 0) {
    return { prs: [], error: failureFromExec(result, runtime.rerunUrl) };
  }
  try {
    const rows = JSON.parse(result.stdout || "[]");
    return {
      prs: rows.map((row) => row.number).filter((number) => number != null),
    };
  } catch {
    return {
      prs: [],
      error: {
        message: "The pull request list was not valid",
        code: "TRANSPORT",
        suggestions: [`Re-run all jobs on ${runtime.rerunUrl}`],
      },
    };
  }
}

function requirePr(runtime, flags, lookup, explicit) {
  const resolved = resolvePr({
    flag: flags.pr,
    envPr: runtime.env.PREVIEW_PR,
    openPrs: lookup.error ? undefined : lookup.prs,
    explicit,
  });
  if (resolved.error) {
    if (!flags.pr && !runtime.env.PREVIEW_PR && lookup.error)
      raise(lookup.error);
    raise(resolved.error);
  }
  return resolved.pr;
}

async function published(runtime, context, pr) {
  if (runtime.imagePublished) return runtime.imagePublished(context, pr);
  if (!context.sha) return false;
  const result = runtime.exec(
    "gh",
    [
      "run",
      "list",
      "--repo",
      context.repo,
      "--workflow",
      "preview-image.yml",
      "--commit",
      context.sha,
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId,conclusion",
    ],
    {},
  );
  if (result.status !== 0) return false;
  try {
    const rows = JSON.parse(result.stdout || "[]");
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function probeOne(runtime, pr) {
  return probePreview(pr, runtime.fetch);
}

async function rowsFor(runtime, prs, fields) {
  const probes = await Promise.all(prs.map((pr) => probeOne(runtime, pr)));
  return probes.map((probe) =>
    withFields(publicRow(probe), savedFor(runtime, probe.pr), fields),
  );
}

function listBody(rows, publishedByPr) {
  if (rows.length === 0) {
    return {
      previews: "0 saved on Wewebplus-ci",
      up: 0,
      down: 0,
      help: [`${BIN} status --pr <number>`],
    };
  }
  const up = rows.filter(
    (row) => row.http === 200 && row.bridge === "yes",
  ).length;
  return {
    previews: rows,
    up,
    down: rows.length - up,
    help: nextSteps(rows, publishedByPr),
  };
}

async function targetPrs(runtime, flags, lookup) {
  if (flags.pr || runtime.env.PREVIEW_PR) {
    return [requirePr(runtime, flags, lookup, false)];
  }
  const saved = savedRows(runtime);
  if (saved.length > 0) return saved.slice(0, 8).map((row) => String(row.pr));
  if (lookup.error) return [];
  return (lookup.prs || []).slice(0, 4).map((number) => String(number));
}

async function runList(args, runtime, command) {
  const { flags } = checked(args, command);
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const prs = await targetPrs(runtime, flags, lookup);
  const rows = await rowsFor(runtime, prs, flags.fields);
  const publishedByPr = {};
  await Promise.all(
    rows.map(async (row) => {
      publishedByPr[row.pr] = await published(runtime, context, row.pr);
    }),
  );
  return listBody(rows, publishedByPr);
}

async function runInspect(args, runtime) {
  const { flags } = checked(args, "inspect");
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, false);
  const probe = await probeOne(runtime, pr);
  const saved = savedFor(runtime, pr);
  return {
    pr: Number(pr),
    url: probe.url,
    http: probe.http,
    bridge: probe.bridge,
    digest: saved?.digest || "unknown",
    tunnel: saved?.tunnel || "unknown",
    gc: "unknown",
    neon: `preview-pr-${pr}`,
    clerk: probe.url,
    transport: runtime.transport,
  };
}

async function runVerify(args, runtime) {
  const { flags } = checked(args, "verify");
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, false);
  const probe = await probeOne(runtime, pr);
  if (probe.http !== 200 || probe.bridge !== "yes") {
    raise({
      message: "Preview is not serving the browser bridge",
      code: "PREVIEW_DOWN",
      suggestions: [`${BIN} resume --pr ${pr}`, `${BIN} inspect --pr ${pr}`],
    });
  }
  return publicRow(probe);
}

function runChecked(runtime, plan) {
  if (plan.error) raise(plan.error);
  const result = runtime.exec(plan.command, plan.args, {
    env: plan.env,
    cwd: runtime.repoRoot || undefined,
  });
  if ((result.status ?? 1) !== 0) {
    const failure = failureFromExec(result, runtime.rerunUrl);
    failure.message = redact(failure.message);
    raise(failure);
  }
  return result;
}

async function runResume(args, runtime) {
  const { flags } = checked(args, "resume");
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = flags.pr
    ? requirePr(runtime, flags, lookup, false)
    : runtime.env.PREVIEW_PR || "";
  if (pr) {
    const probe = await probeOne(runtime, pr);
    const decision = decideResume(probe);
    if (decision.noop) {
      return { result: decision.noop, ...publicRow(probe) };
    }
  }
  const plan = commandPlan({
    transport: runtime.transport,
    action: "resume",
    pr,
    repo: context.repo,
    ref: context.branch,
  });
  const result = runChecked(runtime, plan);
  const parsed = parseResult(redact(result.stdout || ""));
  if (runtime.transport === "actions") {
    return {
      result: "dispatched",
      workflow: "preview-control.yml",
      action: "resume",
      pr: pr ? Number(pr) : "all",
      help: [`${BIN} run list`],
    };
  }
  return {
    result: parsed[0]?.result || "started",
    previews: parsed,
  };
}

async function runDeploy(args, runtime) {
  const { flags } = checked(args, "deploy");
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, false);
  const probe = await probeOne(runtime, pr);
  const isPublished = await published(runtime, context, pr);
  const decision = decideDeploy({ probe, published: isPublished });
  if (decision.noop) {
    return { result: decision.noop, ...publicRow(probe) };
  }
  const saved = savedFor(runtime, pr);
  const plan = commandPlan({
    transport: runtime.transport,
    action: "deploy",
    pr,
    repo: context.repo,
    ref: context.branch,
    digest: saved?.digest || "",
    gitBranch: context.branch,
  });
  runChecked(runtime, plan);
  if (runtime.transport === "actions") {
    return {
      result: "dispatched",
      workflow: "preview-image.yml",
      action: "deploy",
      pr: Number(pr),
      help: [`${BIN} run list`, `${BIN} verify --pr ${pr}`],
    };
  }
  return { result: "started", ...publicRow(probe) };
}

async function runDestroy(args, runtime) {
  const { flags } = checked(args, "destroy");
  if (!flags.pr) {
    raise({
      message: "Pass --pr. This command does not infer a pull request.",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} destroy --pr <number> --yes`],
    });
  }
  if (!flags.yes) {
    raise({
      message: "destroy requires --yes",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} destroy --pr ${flags.pr} --yes`],
    });
  }
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, true);
  const probe = await probeOne(runtime, pr);
  const decision = decideDestroy({
    transport: runtime.transport,
    localState: Boolean(savedFor(runtime, pr)),
    http: probe.http,
  });
  if (decision.noop) {
    return { result: decision.noop, pr: Number(pr) };
  }
  const plan = commandPlan({
    transport: runtime.transport,
    action: "destroy",
    pr,
    repo: context.repo,
    ref: context.branch,
    gitBranch: context.branch,
  });
  const result = runChecked(runtime, plan);
  const parsed = parseResult(redact(result.stdout || ""));
  if (runtime.transport === "actions") {
    return {
      result: "dispatched",
      workflow: "preview-control.yml",
      action: "destroy",
      pr: Number(pr),
      help: [`${BIN} status --pr ${pr}`],
    };
  }
  return {
    result: parsed[0]?.result || "removed",
    pr: Number(pr),
  };
}

async function runLogs(args, runtime) {
  const { flags } = checked(args, "logs");
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, false);
  const plan = commandPlan({
    transport: runtime.transport === "actions" ? "actions" : runtime.transport,
    action: "logs",
    pr,
    repo: context.repo,
    ref: context.branch,
  });
  if (runtime.transport === "actions") {
    const listed = commandPlan({
      transport: "actions",
      action: "logs",
      pr,
      repo: context.repo,
      ref: context.branch,
    });
    runChecked(runtime, listed);
    return {
      result: "dispatched",
      workflow: "preview-control.yml",
      action: "logs",
      pr: Number(pr),
      help: [`${BIN} run list`],
    };
  }
  const result = runChecked(runtime, plan);
  return presentLog(redact(result.stdout || ""), flags.full, pr);
}

function presentLog(text, full, pr) {
  if (full) {
    const dir = mkdtempSync(join(tmpdir(), "wewebplus-preview-"));
    const path = join(dir, "preview.log");
    writeFileSync(path, text);
    return { pr: Number(pr), path, bytes: text.length };
  }
  if (text.length <= LOG_LIMIT) {
    return { pr: Number(pr), log: text, truncated: false };
  }
  return {
    pr: Number(pr),
    log: text.slice(-LOG_LIMIT),
    total: text.length,
    truncated: true,
    help: [`${BIN} logs --pr ${pr} --full`],
  };
}

async function runDb(args, runtime) {
  const { positionals, flags } = checked(args, "db");
  const sub = positionals[0];
  if (!["status", "ensure", "assign"].includes(sub)) {
    raise({
      message: "db requires status, ensure, or assign",
      code: "VALIDATION_ERROR",
      suggestions: [
        `${BIN} db status --pr <number>`,
        `${BIN} db ensure --pr <number>`,
        `${BIN} db assign --pr <number>`,
      ],
    });
  }
  const context = await loadContext(runtime, flags);
  const lookup = await lookupPrs(runtime, context);
  const pr = requirePr(runtime, flags, lookup, false);
  if (sub === "status" && runtime.transport !== "local") {
    return {
      pr: Number(pr),
      neon: `preview-pr-${pr}`,
      transport: runtime.transport,
    };
  }
  const plan = commandPlan({
    transport: runtime.transport,
    action: `db-${sub}`,
    pr,
    repo: context.repo,
    ref: context.branch,
    gitBranch: context.branch,
  });
  const result = runChecked(runtime, plan);
  if (runtime.transport === "actions") {
    return {
      result: "dispatched",
      workflow: "preview-control.yml",
      action: `db-${sub}`,
      pr: Number(pr),
      neon: `preview-pr-${pr}`,
      help: [`${BIN} run list`],
    };
  }
  const parsed = parseResult(redact(result.stdout || ""));
  return {
    pr: Number(pr),
    neon: `preview-pr-${pr}`,
    result: parsed[0] || "ok",
  };
}

function runEnv(args, runtime) {
  const { positionals } = checked(args, "env");
  if (positionals[0] !== "status") {
    raise({
      message: "env requires status",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} env status`],
    });
  }
  return { secrets: secretStatus(runtime.env) };
}

async function runRun(args, runtime) {
  const { positionals, flags } = checked(args, "run");
  const sub = positionals[0];
  if (sub !== "list" && sub !== "view") {
    raise({
      message: "run requires list or view",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} run list`, `${BIN} run view <id>`],
    });
  }
  if (sub === "view" && !positionals[1]) {
    raise({
      message: "run view requires a run id",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} run view <id>`],
    });
  }
  const context = await loadContext(runtime, flags);
  const repo = context.repo || "";
  if (!repo) {
    raise({
      message: "Pass --repo owner/name",
      code: "VALIDATION_ERROR",
    });
  }
  if (sub === "view") {
    const result = runChecked(runtime, {
      command: "gh",
      args: [
        "run",
        "view",
        positionals[1],
        "--repo",
        repo,
        "--json",
        "databaseId,displayTitle,status,conclusion,url,headSha",
      ],
    });
    let row;
    try {
      row = JSON.parse(result.stdout || "null");
    } catch {
      raise({
        message: "The workflow run was not valid",
        code: "TRANSPORT",
      });
    }
    return {
      id: row.databaseId,
      title: row.displayTitle,
      status: row.status || row.conclusion,
      url: row.url,
    };
  }
  const jsonFields = "databaseId,displayTitle,status,conclusion,url,headSha";
  const lists = ["preview-image.yml", "preview-control.yml"].map((workflow) => {
    const result = runChecked(runtime, {
      command: "gh",
      args: [
        "run",
        "list",
        "--repo",
        repo,
        "--workflow",
        workflow,
        "--limit",
        "5",
        "--json",
        jsonFields,
      ],
    });
    try {
      return JSON.parse(result.stdout || "[]");
    } catch {
      raise({
        message: "The workflow run list was not valid",
        code: "TRANSPORT",
      });
    }
  });
  const list = lists
    .flat()
    .filter((row) => row && row.databaseId)
    .slice(0, 5);
  if (list.length === 0) return { runs: "0 preview runs" };
  return {
    runs: list.map((row) => ({
      id: row.databaseId,
      title: row.displayTitle,
      status: row.status || row.conclusion,
      url: row.url,
    })),
  };
}

async function runSetup(args, runtime) {
  const { positionals } = checked(args, "setup");
  if (positionals[0] !== "hooks") {
    raise({
      message: "setup requires hooks",
      code: "VALIDATION_ERROR",
      suggestions: [`${BIN} setup hooks`],
    });
  }
  await runtime.installHooks({
    scope: "project",
    marker: BIN,
    binaryNames: [BIN],
  });
  return { setup: "hooks installed or already up to date" };
}

export async function main(options = {}) {
  const runtime = createRuntime(options);
  const cli = {
    description: "Check and control Wewebplus previews on Wewebplus-ci.",
    version: VERSION,
    packageName: "wewebplus-preview",
    argv: options.argv ?? process.argv.slice(2),
    topLevelHelp: TOP_LEVEL_HELP,
    getCommandHelp: (command) => COMMAND_HELP[command],
    home: () => runList([], runtime, "status"),
    commands: {
      status: (args) => runList(args, runtime, "status"),
      inspect: (args) => runInspect(args, runtime),
      verify: (args) => runVerify(args, runtime),
      logs: (args) => runLogs(args, runtime),
      resume: (args) => runResume(args, runtime),
      deploy: (args) => runDeploy(args, runtime),
      destroy: (args) => runDestroy(args, runtime),
      db: (args) => runDb(args, runtime),
      env: (args) => runEnv(args, runtime),
      run: (args) => runRun(args, runtime),
      setup: (args) => runSetup(args, runtime),
    },
  };
  if (options.stdout) cli.stdout = options.stdout;
  await runAxiCli(cli);
}
