import {
  CONTROL_WORKFLOW,
  DEVBOX,
  IMAGE_WORKFLOW,
  SECRET_NAMES,
} from "./constants.js";

export function parseRepo(remoteUrl) {
  const match = String(remoteUrl).match(
    /github\.com[:/]([^/\s]+\/[^/\s.]+?)(?:\.git)?$/,
  );
  return match ? match[1] : "";
}

export function resolvePr({ flag, envPr, openPrs, explicit }) {
  if (explicit && !flag) {
    return {
      error: {
        message: "Pass --pr. This command does not infer a pull request.",
        code: "VALIDATION_ERROR",
        suggestions: [`wewebplus-preview destroy --pr <number> --yes`],
      },
    };
  }
  const chosen = flag || (!explicit ? envPr : "");
  if (chosen) {
    if (!/^[0-9]+$/.test(String(chosen))) {
      return {
        error: {
          message: "--pr must be a pull request number",
          code: "VALIDATION_ERROR",
        },
      };
    }
    return { pr: String(chosen) };
  }
  const prs = openPrs ?? [];
  if (prs.length === 1) return { pr: String(prs[0]) };
  if (prs.length === 0) {
    return {
      error: {
        message: "No open pull request for this branch",
        code: "VALIDATION_ERROR",
        suggestions: ["Pass --pr <number>"],
      },
    };
  }
  return {
    error: {
      message: "Several open pull requests match this branch",
      code: "VALIDATION_ERROR",
      suggestions: prs.map(
        (number) => `wewebplus-preview status --pr ${number}`,
      ),
    },
  };
}

export function selectTransport({ env, repoHasScripts, tokenFileExists }) {
  if (env.PREVIEW_REPO && repoHasScripts) return "local";
  if (env.GITHUB_ACTIONS === "true") return "devbox";
  if (env.NSC_TOKEN_FILE && tokenFileExists) return "devbox";
  return "actions";
}

export function decideResume(probe) {
  if (probe && probe.http === 200 && probe.bridge === "yes") {
    return { noop: "already_running", probe };
  }
  return { run: "resume" };
}

export function decideDeploy({ probe, published }) {
  if (
    probe &&
    probe.http === 200 &&
    probe.bridge === "yes" &&
    published === true
  ) {
    return { noop: "already_current", probe };
  }
  return { run: "deploy" };
}

export function decideDestroy({ transport, localState, http }) {
  if (http === 530) return { run: "destroy" };
  if (transport === "local" && !localState && http !== 530) {
    return { noop: "already_absent" };
  }
  return { run: "destroy" };
}

export function commandPlan({
  transport,
  action,
  pr,
  repo,
  ref,
  digest,
  gitBranch,
}) {
  if (
    (action === "deploy" || action === "logs" || action.startsWith("db-")) &&
    !pr
  ) {
    return {
      error: {
        message: "Pass --pr <number>",
        code: "VALIDATION_ERROR",
      },
    };
  }
  if (action === "deploy" && transport !== "actions" && !digest) {
    return {
      error: {
        message:
          "No saved image for this preview. The Preview image workflow publishes it. This command does not build an image.",
        code: "IMAGE_MISSING",
        suggestions: [
          `wewebplus-preview deploy --pr ${pr}`,
          "Use the Actions transport when this machine has no saved digest.",
        ],
      },
    };
  }
  if (transport === "local") {
    if (action === "resume") {
      return {
        command: "bash",
        args: ["scripts/gascity/preview-resume.sh"],
        env: pr ? { PREVIEW_RESUME_ONLY: String(pr) } : {},
      };
    }
    if (action === "deploy") {
      return {
        command: "bash",
        args: ["scripts/gascity/preview-up.sh", String(pr), digest],
        env: { PREVIEW_SKIP_TUNNEL: "1" },
      };
    }
    if (action === "logs") {
      return {
        command: "docker",
        args: ["logs", "--tail", "400", `preview-${pr}-dyad-1`],
      };
    }
    return {
      command: "bash",
      args: [
        "scripts/gascity/preview-control.sh",
        action,
        pr ? String(pr) : "",
        gitBranch || "",
      ],
    };
  }
  if (transport === "devbox") {
    return {
      command: "devbox",
      args: [
        "exec",
        DEVBOX,
        "--",
        "bash",
        "scripts/gascity/preview-control.sh",
        action === "deploy" ? "deploy" : action,
        pr ? String(pr) : "",
        gitBranch || "",
      ],
    };
  }
  if (action === "deploy") {
    return {
      command: "gh",
      args: ["workflow", "run", IMAGE_WORKFLOW, "--repo", repo, "--ref", ref],
    };
  }
  const args = [
    "workflow",
    "run",
    CONTROL_WORKFLOW,
    "--repo",
    repo,
    "--ref",
    ref,
    "-f",
    `action=${action}`,
  ];
  if (pr) args.push("-f", `pr=${pr}`);
  if (gitBranch) args.push("-f", `git_branch=${gitBranch}`);
  return { command: "gh", args };
}

export function failureFromExec(result, rerunUrl) {
  const text = `${result.stderr || ""}\n${result.stdout || ""}`;
  const denied =
    result.status === 403 ||
    /\b403\b|Resource not accessible|not running in a GitHub action|workflow_dispatch|could not find workflow/i.test(
      text,
    );
  if (denied) {
    return {
      message:
        "GitHub refused the workflow dispatch. workflow_dispatch works after the workflow file is on the default branch.",
      code: "TRANSPORT",
      suggestions: [`Re-run all jobs on ${rerunUrl}`],
    };
  }
  const detail = text.trim().slice(0, 400);
  return {
    message: detail || "The preview command failed",
    code: "TRANSPORT",
    suggestions: [`Re-run all jobs on ${rerunUrl}`],
  };
}

export function nextSteps(rows, publishedByPr) {
  const steps = [];
  for (const row of rows) {
    if (row.http === 200 && row.bridge === "yes") continue;
    if (publishedByPr[row.pr]) {
      steps.push(`wewebplus-preview resume --pr ${row.pr}`);
    } else {
      steps.push(`wewebplus-preview deploy --pr ${row.pr}`);
    }
  }
  if (steps.length === 0 && rows.length > 0) {
    steps.push(`wewebplus-preview verify --pr ${rows[0].pr}`);
  }
  return steps.slice(0, 3);
}

export function publicRow(probe) {
  return {
    pr: Number(probe.pr),
    url: probe.url,
    http: probe.http,
    bridge: probe.bridge,
  };
}

export function withFields(row, saved, fields) {
  if (!fields) return row;
  const extra = {};
  for (const name of String(fields)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (name === "digest") extra.digest = saved?.digest || "unknown";
    if (name === "tunnel") extra.tunnel = saved?.tunnel || "unknown";
    if (name === "gc") extra.gc = saved?.gc || "unknown";
  }
  return { ...row, ...extra };
}

export function parseResult(stdout) {
  return String(stdout)
    .split("\n")
    .filter((line) => line.startsWith("preview_result "))
    .map((line) => {
      const fields = {};
      for (const part of line.slice("preview_result ".length).split(/\s+/)) {
        const index = part.indexOf("=");
        if (index > 0) fields[part.slice(0, index)] = part.slice(index + 1);
      }
      return fields;
    });
}

export function secretStatus(env) {
  return SECRET_NAMES.map((name) => ({
    name,
    state: env[name] ? "present" : "absent",
  }));
}
