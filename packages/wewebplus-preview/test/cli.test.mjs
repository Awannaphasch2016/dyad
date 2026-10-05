import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { main } from "../src/cli.js";
import { skillDocument } from "../src/help.js";
import { readSavedPreviews } from "../src/io.js";
import { commandPlan, decideDestroy, parseRepo } from "../src/plan.js";
import { VERSION } from "../src/version.js";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const digest =
  "ghcr.io/awannaphasch2016/dyad@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function page(status, body = "") {
  return async (url) => ({ status, url, text: async () => body });
}

async function capture(argv, overrides = {}) {
  const calls = [];
  let out = "";
  process.exitCode = 0;
  await main({
    argv,
    stdout: {
      write(chunk) {
        out += chunk;
      },
    },
    env: overrides.env ?? {},
    transport: overrides.transport ?? "actions",
    context:
      overrides.context === null
        ? undefined
        : (overrides.context ?? {
            repo: "Awannaphasch2016/dyad",
            branch: "cursor/formula-preview-9e7a",
            sha: "4fcdc500",
          }),
    fetch:
      overrides.fetch ??
      (async () => {
        throw new Error("fetch was called");
      }),
    imagePublished: overrides.imagePublished ?? (async () => false),
    openPrs: overrides.openPrs ?? (() => ({ prs: [27] })),
    savedPreviews: overrides.savedPreviews ?? (() => []),
    installHooks: overrides.installHooks ?? (async () => {}),
    exec:
      overrides.exec ??
      ((command, args, opts) => {
        calls.push({ command, args, env: opts?.env });
        return { status: 0, stdout: "", stderr: "" };
      }),
  });
  return { out, code: process.exitCode ?? 0, calls };
}

test("unknown flags fail before any probe", async () => {
  const result = await capture(["status", "--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.out, /Unknown flag: --nope/);
  assert.match(result.out, /Valid flags:/);
  assert.equal(result.calls.length, 0);
});

test("flags before the command are a usage error", async () => {
  const result = await capture(["--pr", "27"]);
  assert.equal(result.code, 2);
  assert.equal(result.calls.length, 0);
});

test("a missing pull request list is a usage error", async () => {
  const result = await capture(["verify"], {
    openPrs: () => ({ prs: [] }),
  });
  assert.equal(result.code, 2);
  assert.match(result.out, /No open pull request/);
});

test("several pull requests are listed and not probed", async () => {
  const result = await capture(["verify"], {
    openPrs: () => ({ prs: [20, 27] }),
  });
  assert.equal(result.code, 2);
  assert.match(result.out, /status --pr 20/);
  assert.match(result.out, /status --pr 27/);
});

test("PREVIEW_PR is used and --pr wins", async () => {
  const seen = [];
  const fromEnv = await capture(["verify"], {
    env: { PREVIEW_PR: "20" },
    openPrs: () => ({ prs: [] }),
    fetch: page(200, "data-dyad-browser-bridge"),
  });
  assert.equal(fromEnv.code, 0);
  assert.match(fromEnv.out, /pr-20/);
  const fromFlag = await capture(["verify", "--pr", "27"], {
    env: { PREVIEW_PR: "20" },
    fetch: async (url) => {
      seen.push(url);
      return { status: 200, text: async () => "data-dyad-browser-bridge" };
    },
  });
  assert.equal(fromFlag.code, 0);
  assert.match(seen[0], /pr-27/);
});

test("verify exits 0 only for the browser bridge", async () => {
  const ok = await capture(["verify", "--pr", "27"], {
    fetch: page(200, "<div data-dyad-browser-bridge></div>"),
  });
  assert.equal(ok.code, 0);
  assert.match(ok.out, /pr-27/);
  assert.equal(ok.calls.length, 0);
  const down = await capture(["verify", "--pr", "27"], {
    fetch: page(530, ""),
  });
  assert.equal(down.code, 1);
  assert.match(down.out, /browser bridge/);
});

test("home suggests resume when the image is published and deploy when it is missing", async () => {
  const resume = await capture(["status", "--pr", "27"], {
    fetch: page(530, ""),
    imagePublished: async () => true,
  });
  assert.equal(resume.code, 0);
  assert.match(resume.out, /530/);
  assert.match(resume.out, /wewebplus-preview resume --pr 27/);
  assert.equal(resume.calls.length, 0);
  const deploy = await capture([], {
    fetch: page(404, ""),
    imagePublished: async () => false,
  });
  assert.match(deploy.out, /wewebplus-preview deploy --pr 27/);
});

test("an empty preview list says zero saved", async () => {
  const result = await capture(["status"], {
    openPrs: () => ({ prs: [] }),
    savedPreviews: () => [],
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /0 saved on Wewebplus-ci/);
});

test("resume of a live page does not build or dispatch", async () => {
  const result = await capture(["resume", "--pr", "27"], {
    fetch: page(200, "data-dyad-browser-bridge"),
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /already_running/);
  assert.equal(result.calls.length, 0);
});

test("resume of a down page dispatches preview control and does not build", async () => {
  const result = await capture(["resume", "--pr", "27"], {
    fetch: page(530, ""),
  });
  assert.equal(result.code, 0);
  const args = result.calls[0].args.join(" ");
  assert.match(args, /preview-control\.yml/);
  assert.match(args, /action=resume/);
  assert.match(args, /pr=27/);
  assert.equal(args.includes("preview-image"), false);
  assert.equal(args.includes("build"), false);
});

test("local resume sets PREVIEW_RESUME_ONLY and does not pass the skip argument", async () => {
  const result = await capture(["resume", "--pr", "27"], {
    transport: "local",
    fetch: page(530, ""),
    exec: (command, args, opts) => {
      assert.equal(command, "bash");
      assert.deepEqual(args, ["scripts/gascity/preview-resume.sh"]);
      assert.equal(opts.env.PREVIEW_RESUME_ONLY, "27");
      return {
        status: 0,
        stdout: "preview_result pr=27 action=resume result=started\n",
        stderr: "",
      };
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /started/);
});

test("deploy of the live published page is already current", async () => {
  const result = await capture(["deploy", "--pr", "27"], {
    fetch: page(200, "data-dyad-browser-bridge"),
    imagePublished: async () => true,
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /already_current/);
  assert.equal(result.calls.length, 0);
});

test("deploy of a missing image dispatches preview image and does not build here", async () => {
  const result = await capture(["deploy", "--pr", "27"], {
    fetch: page(530, ""),
    imagePublished: async () => false,
  });
  assert.equal(result.code, 0);
  const args = result.calls[0].args.join(" ");
  assert.match(args, /preview-image\.yml/);
  assert.equal(args.includes("docker"), false);
  assert.equal(args.includes("build"), false);
});

test("local deploy of a saved digest starts preview-up and does not build", async () => {
  const result = await capture(["deploy", "--pr", "27"], {
    transport: "local",
    fetch: page(530, ""),
    savedPreviews: () => [{ pr: "27", digest, tunnel: "named" }],
    exec: (command, args) => {
      assert.equal(command, "bash");
      assert.equal(args[0], "scripts/gascity/preview-up.sh");
      assert.equal(args[2], digest);
      assert.equal(args.join(" ").includes("build"), false);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.code, 0);
});

test("database assign uses the pull request branch", async () => {
  const result = await capture(["db", "assign", "--pr", "27"]);
  const args = result.calls[0].args.join(" ");
  assert.match(args, /action=db-assign/);
  assert.match(args, /git_branch=cursor\/formula-preview-9e7a/);
  assert.equal(args.includes("dyad-web-frontend-bbea"), false);
});

test("destroy requires --pr and --yes before it dispatches", async () => {
  const missingYes = await capture(["destroy", "--pr", "29"]);
  assert.equal(missingYes.code, 2);
  assert.match(missingYes.out, /--yes/);
  assert.equal(missingYes.calls.length, 0);
  const missingPr = await capture(["destroy", "--yes"]);
  assert.equal(missingPr.code, 2);
  assert.equal(missingPr.calls.length, 0);
});

test("HTTP 530 is not already absent", async () => {
  assert.deepEqual(
    decideDestroy({ transport: "local", localState: false, http: 530 }),
    { run: "destroy" },
  );
  const result = await capture(["destroy", "--pr", "29", "--yes"], {
    fetch: page(530, ""),
  });
  assert.equal(result.code, 0);
  assert.match(result.calls[0].args.join(" "), /action=destroy/);
});

test("a local destroy with no saved state is already absent", async () => {
  const result = await capture(["destroy", "--pr", "29", "--yes"], {
    transport: "local",
    fetch: page(404, ""),
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /already_absent/);
  assert.equal(result.calls.length, 0);
});

test("a refused dispatch points at re-run and does not suggest an empty commit", async () => {
  const result = await capture(["resume", "--pr", "27"], {
    fetch: page(530, ""),
    exec: () => ({ status: 1, stdout: "", stderr: "HTTP 403" }),
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /actions\/runs\/37258984319/);
  assert.match(result.out, /default branch/);
  assert.equal(result.out.includes("empty commit"), false);
});

test("logs redact secrets and truncate", async () => {
  const secret =
    "nsrt_abc dp.st.preview.SECRET CLOUDFLARE_TUNNEL_TOKEN=tunnelvalue";
  const redacted = await capture(["logs", "--pr", "27"], {
    transport: "local",
    exec: () => ({ status: 0, stdout: secret, stderr: "" }),
  });
  assert.equal(redacted.out.includes("nsrt_abc"), false);
  assert.equal(redacted.out.includes("dp.st."), false);
  assert.equal(redacted.out.includes("tunnelvalue"), false);
  const long = `START${"x".repeat(3000)}END`;
  const truncated = await capture(["logs", "--pr", "27"], {
    transport: "local",
    exec: () => ({ status: 0, stdout: long, stderr: "" }),
  });
  assert.match(truncated.out, /END/);
  assert.equal(truncated.out.includes("START"), false);
  assert.match(truncated.out, /truncated:\s*true/);
  const full = await capture(["logs", "--pr", "27", "--full"], {
    transport: "local",
    exec: () => ({ status: 0, stdout: long, stderr: "" }),
  });
  assert.match(full.out, /wewebplus-preview-/);
  assert.equal(full.out.includes("START"), false);
});

test("env status reports presence without values", async () => {
  const result = await capture(["env", "status"], {
    env: { CLOUDFLARE_API_TOKEN: "super-secret-value" },
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /CLOUDFLARE_API_TOKEN/);
  assert.match(result.out, /present/);
  assert.match(result.out, /NEON_API_KEY/);
  assert.match(result.out, /absent/);
  assert.equal(result.out.includes("super-secret-value"), false);
});

test("setup hooks is opt-in and does not run during other commands", async () => {
  let installed = 0;
  const result = await capture(["setup", "hooks"], {
    installHooks: async (options) => {
      installed += 1;
      assert.equal(options.scope, "project");
      assert.equal(options.marker, "wewebplus-preview");
    },
  });
  assert.equal(result.code, 0);
  assert.equal(installed, 1);
  const unknown = await capture(["setup", "widgets"]);
  assert.equal(unknown.code, 2);
  assert.equal(installed, 1);
});

test("run list reports zero preview runs", async () => {
  const result = await capture(["run", "list"], {
    exec: (command, args) => {
      assert.equal(command, "gh");
      assert.match(args.join(" "), /--workflow/);
      return { status: 0, stdout: "[]", stderr: "" };
    },
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /0 preview runs/);
});

test("saved state does not return a tunnel token", () => {
  const dir = mkdtempSync(join(tmpdir(), "wewebplus-state-"));
  try {
    writeFileSync(
      join(dir, "preview-27.env"),
      `PREVIEW_IMAGE=${digest}\nCLOUDFLARE_TUNNEL_TOKEN=tunnel-secret-value\n`,
    );
    const rows = readSavedPreviews(dir);
    assert.equal(rows[0].tunnel, "named");
    assert.equal(rows[0].digest, digest);
    assert.equal(JSON.stringify(rows).includes("tunnel-secret-value"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a machine without a git checkout dispatches the Wewebplus repo", async () => {
  const seen = [];
  const result = await capture(["resume", "--pr", "27"], {
    context: null,
    fetch: page(530, ""),
    exec: (command, args) => {
      if (command === "git") return { status: 1, stdout: "", stderr: "" };
      seen.push(args.join(" "));
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.code, 0);
  assert.match(seen[0], /--repo Awannaphasch2016\/dyad/);
  assert.match(seen[0], /--ref cursor\/formula-preview-9e7a/);
  assert.equal(seen[0].includes("preview-image"), false);
});

test("repo parsing and resume plan stay off the image build", () => {
  assert.equal(
    parseRepo("https://github.com/Awannaphasch2016/dyad.git"),
    "Awannaphasch2016/dyad",
  );
  assert.equal(
    parseRepo("git@github.com:Awannaphasch2016/dyad.git"),
    "Awannaphasch2016/dyad",
  );
  const plan = commandPlan({
    transport: "local",
    action: "resume",
    pr: "27",
    repo: "Awannaphasch2016/dyad",
    ref: "cursor/formula-preview-9e7a",
  });
  assert.deepEqual(plan.args, ["scripts/gascity/preview-resume.sh"]);
  assert.equal(plan.env.PREVIEW_RESUME_ONLY, "27");
  assert.equal(JSON.stringify(plan).includes("preview-image"), false);
  assert.equal(JSON.stringify(plan).includes("build"), false);
});

test("the skill matches the command list", () => {
  const skill = readFileSync(
    new URL("../skill/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.equal(skill, skillDocument());
});

test("version.js stays on node builtins", () => {
  const source = readFileSync(
    new URL("../src/version.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("axi-sdk"), false);
  const printed = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { VERSION } from './src/version.js'; process.stdout.write(VERSION)",
    ],
    { cwd: packageDir, encoding: "utf8" },
  );
  assert.equal(printed.status, 0);
  assert.equal(printed.stdout, VERSION);
});

test("the package does not import the Dyad app", () => {
  const files = readdirSync(new URL("../src", import.meta.url));
  for (const file of files) {
    const text = readFileSync(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.equal(text.includes("deploy/preview"), false);
    assert.equal(text.includes('from "@/'), false);
  }
});

test("--version uses the fast path and an unknown command exits 2", () => {
  const version = spawnSync(process.execPath, ["bin.js", "--version"], {
    cwd: packageDir,
    encoding: "utf8",
  });
  assert.equal(version.status, 0);
  assert.equal(version.stdout, `${VERSION}\n`);
  const unknown = spawnSync(process.execPath, ["bin.js", "nope"], {
    cwd: packageDir,
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
});
