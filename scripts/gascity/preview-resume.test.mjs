import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./preview-resume.sh", import.meta.url);
const digest =
  "ghcr.io/awannaphasch2016/dyad@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function writeEnv(dir, pr, { token = "tunnel-token", image = digest } = {}) {
  const lines = [
    `PREVIEW_PR=${pr}`,
    `PREVIEW_IMAGE=${image}`,
    `PREVIEW_ENV_FILE=${dir}/preview-${pr}.env`,
  ];
  if (token) lines.push(`CLOUDFLARE_TUNNEL_TOKEN=${token}`);
  writeFileSync(join(dir, `preview-${pr}.env`), `${lines.join("\n")}\n`, {
    mode: 0o600,
  });
}

function fakeDocker(binDir) {
  const docker = join(binDir, "docker");
  writeFileSync(
    docker,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  *" preview-20 "*)
    if [ "$DOCKER_FAIL_20" = "1" ]; then exit 1; fi
    ;;
esac
exit 0
`,
  );
  chmodSync(docker, 0o755);
  return docker;
}

function run(
  state,
  {
    skip = "",
    memKb = 8 * 1024 * 1024,
    fail20 = false,
    marker,
    only = "",
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "preview-resume-run-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "docker.log");
  writeFileSync(log, "");
  fakeDocker(bin);
  const meminfo = join(root, "meminfo");
  writeFileSync(meminfo, `MemAvailable: ${memKb} kB\n`);
  const result = spawnSync("bash", [script.pathname, ...(skip ? [skip] : [])], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      PREVIEW_STATE_DIR: state,
      PREVIEW_MEMINFO_FILE: meminfo,
      PREVIEW_PRODUCTION_MARKER: marker ?? join(root, "missing-marker"),
      DOCKER_LOG: log,
      DOCKER_FAIL_20: fail20 ? "1" : "0",
      ...(only ? { PREVIEW_RESUME_ONLY: only } : {}),
    },
  });
  const commands = readFileSync(log, "utf8");
  rmSync(root, { recursive: true, force: true });
  return { ...result, commands };
}

test("a saved tunnel token is started and the current pull request is skipped", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  try {
    writeEnv(state, 20);
    writeEnv(state, 27);
    const result = run(state, { skip: "27" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /preview-27 is handled by this deploy/);
    assert.match(result.stdout, /Resuming preview-20/);
    assert.match(
      result.stdout,
      /preview_result pr=20 action=resume result=started/,
    );
    assert.match(result.commands, /compose --env-file/);
    assert.match(result.commands, /-p preview-20/);
    assert.match(
      result.commands,
      /--profile tunnel up -d --no-recreate dyad cloudflared/,
    );
    assert.equal(result.commands.includes("preview-27"), false);
    assert.equal(result.commands.includes(" stop"), false);
    assert.equal(result.commands.includes(" down"), false);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("a preview without a tunnel token is left stopped", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  try {
    writeEnv(state, 29, { token: "" });
    const result = run(state);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /preview-29 has no tunnel token/);
    assert.match(
      result.stdout,
      /preview_result pr=29 action=resume result=left_stopped/,
    );
    assert.equal(result.commands, "");
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("low memory leaves saved previews stopped and does not stop them", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  try {
    writeEnv(state, 20);
    writeEnv(state, 27);
    const result = run(state, { memKb: 1024 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /preview-20 was left stopped/);
    assert.match(result.stdout, /preview-27 was left stopped/);
    assert.equal(result.commands, "");
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("one preview failing does not stop the next resume", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  try {
    writeEnv(state, 20);
    writeEnv(state, 27);
    const result = run(state, { fail20: true });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /preview-20 did not start/);
    assert.match(result.commands, /-p preview-20/);
    assert.match(result.commands, /-p preview-27/);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test("the production checkout is refused", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  const marker = mkdtempSync(join(tmpdir(), "preview-resume-marker-"));
  try {
    writeEnv(state, 20);
    const result = run(state, { marker });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing/);
    assert.equal(result.commands, "");
  } finally {
    rmSync(state, { recursive: true, force: true });
    rmSync(marker, { recursive: true, force: true });
  }
});

test("devbox remote scripts resume saved previews", () => {
  const workflows = [
    "../../.github/workflows/preview-image.yml",
    "../../.github/workflows/preview.yml",
    "../../.github/workflows/preview-exec.yml",
    "../../.github/workflows/preview-secrets.yml",
    "../../.github/workflows/preview-vercel-db.yml",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const workflow of workflows) {
    assert.match(workflow, /preview-resume\.sh/);
  }
  assert.match(workflows[1], /preview-resume\.sh "\$pr"/);
  assert.match(
    workflows[1],
    /rm -f "\$state\/preview-\$\{pr\}\.env" "\$state\/preview-\$\{pr\}\.tunnel-token" "\$state\/preview-\$\{pr\}\.public-url"/,
  );
  const destroy = workflows[1].slice(
    workflows[1].indexOf("Remove the preview"),
  );
  assert.ok(
    destroy.indexOf("preview-resume.sh") < destroy.indexOf("docker compose -p"),
  );
  assert.ok(
    destroy.indexOf("tunnel-token") < destroy.indexOf("docker compose -p"),
  );
  assert.match(workflows[2], /echo federated-ok/);
  assert.equal(workflows[2].split("preview-resume.sh").length, 2);
});

test("PREVIEW_RESUME_ONLY starts that preview and does not skip it", () => {
  const state = mkdtempSync(join(tmpdir(), "preview-resume-state-"));
  try {
    writeEnv(state, 20);
    writeEnv(state, 27);
    const result = run(state, { only: "27" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resuming preview-27/);
    assert.match(
      result.stdout,
      /preview_result pr=27 action=resume result=started/,
    );
    assert.match(result.commands, /-p preview-27/);
    assert.equal(result.commands.includes("preview-20"), false);
    assert.equal(result.stdout.includes("handled by this deploy"), false);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
