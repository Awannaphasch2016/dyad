import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { HELP, checkVerify, main, parseArgs, resolve } from "../lib/cli.js";
import { fakeGh, RUN, log } from "./fake_gh.mjs";

function capture() {
  const out = [];
  const err = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      sleep: async () => {},
      now: () => Date.parse("2026-10-09T10:00:00Z"),
      interval: 1,
    },
    out: () => out.join("\n"),
    err: () => err.join("\n"),
  };
}

test("help lists every operation and the dispatch note", () => {
  for (const name of [
    "ec2 check",
    "formula role",
    "formula verify",
    "formula deploy",
    "rollout <sha>",
    "run <workflow.yml>",
  ]) {
    assert.ok(HELP.includes(name), `help mentions ${name}`);
  }
  assert.match(HELP, /default branch/);
});

test("operations resolve to their workflow and default ref", () => {
  const { words, flags } = parseArgs(["formula", "role"]);
  const op = resolve(words, flags);
  assert.equal(op.workflow, "preview-formula-role.yml");
  assert.equal(op.ref, "cursor/formula-config-ui-55d6");

  const rollout = resolve(...Object.values(parseArgs(["rollout", "5e952bbc"])));
  assert.deepEqual(rollout.fields, ["commit=5e952bbc"]);

  assert.throws(
    () => resolve(...Object.values(parseArgs(["rollout", "not-a-sha"]))),
    /needs <sha>/,
  );
  assert.throws(
    () => resolve(...Object.values(parseArgs(["run", "x.yml"]))),
    /--ref/,
  );
  assert.throws(
    () =>
      resolve(...Object.values(parseArgs(["run", "../x.yml", "--ref", "b"]))),
    /workflow file/,
  );
  assert.throws(
    () => resolve(...Object.values(parseArgs(["dance"]))),
    /Unknown operation/,
  );
  assert.throws(() => parseArgs(["--bogus"]), /Unknown flag/);
});

test("verify compares result lines against expectations", () => {
  const results = new Map([
    ["AWS_PREVIEW_FORMULA_ROLE_ARN", "absent"],
    ["url", "http://x"],
  ]);
  assert.deepEqual(
    checkVerify(
      [{ key: "AWS_PREVIEW_FORMULA_ROLE_ARN", expect: "present" }],
      results,
    ),
    ["AWS_PREVIEW_FORMULA_ROLE_ARN=absent, expected present"],
  );
  assert.deepEqual(
    checkVerify([{ key: "url", expect: /^https?:/ }], results),
    [],
  );
  assert.deepEqual(checkVerify([{ key: "missing", expect: "x" }], results), [
    "missing was not printed",
  ]);
});

test("ec2 check reports the run and its result lines", async () => {
  const gh = fakeGh({
    "workflow run": { stdout: "" },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run watch": { status: 1 },
    "run view": {
      stdout: log([
        "github_ec2_ssh_key=absent",
        "github_doppler_token=absent",
        "The Doppler sync for project dyad, config preview, is not delivering EC2_SSH_KEY to this repository.",
      ]),
    },
  });
  const c = capture();
  const code = await main(["ec2", "check"], { ...c.io, gh });
  assert.equal(code, 1);
  const text = c.out();
  assert.match(text, /operation: ec2 check/);
  assert.match(text, /workflow: ec2-access-check\.yml/);
  assert.match(text, /mode: dispatch/);
  assert.match(text, /id: 4242/);
  assert.match(text, /conclusion: failure/);
  assert.match(
    text,
    /results\[2\]:\n {2}github_ec2_ssh_key: absent\n {2}github_doppler_token: absent/,
  );
  assert.match(
    text,
    /Logs: gh run view 4242 --log-failed -R Awannaphasch2016\/dyad/,
  );
});

test("formula verify fails when the role ARN is absent even if the run passed", async () => {
  const gh = fakeGh({
    "workflow run": { stdout: "" },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run watch": { status: 0 },
    "run view": {
      stdout: log(["AWS_PREVIEW_FORMULA_ROLE_ARN=absent", "host_doppler=ok"]),
    },
  });
  const c = capture();
  const code = await main(["formula", "verify", "--json"], { ...c.io, gh });
  assert.equal(code, 1);
  const json = JSON.parse(c.out());
  assert.equal(json.conclusion, "success");
  assert.deepEqual(json.verify_failed, [
    "AWS_PREVIEW_FORMULA_ROLE_ARN=absent, expected present",
  ]);
  assert.equal(json.results.AWS_PREVIEW_FORMULA_ROLE_ARN, "absent");
});

test("formula deploy prints the url when the run passes", async () => {
  const gh = fakeGh({
    "workflow run": { stdout: "" },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run watch": { status: 0 },
    "run view": {
      stdout: log([
        "url=http://formula-preview-1.ap-southeast-1.elb.amazonaws.com",
      ]),
    },
  });
  const c = capture();
  const code = await main(["formula", "deploy"], { ...c.io, gh });
  assert.equal(code, 0);
  assert.match(c.out(), /url: http:\/\/formula-preview-1/);
});

test("--no-wait returns after the run is found", async () => {
  const gh = fakeGh({
    "workflow run": { stdout: "" },
    "run list": { stdout: JSON.stringify([{ ...RUN, status: "queued" }]) },
  });
  const c = capture();
  const code = await main(["rollout", "5e952bbc", "--no-wait"], {
    ...c.io,
    gh,
  });
  assert.equal(code, 0);
  assert.match(c.out(), /conclusion: queued/);
  assert.match(c.out(), /Watch: gh run watch 4242/);
  assert.ok(!gh.calls.some((call) => call[1] === "watch"));
});

test("a refused dispatch is reported as a rerun with its commit", async () => {
  const gh = fakeGh({
    "workflow run": { status: 1, stderr: "HTTP 404: Not Found" },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run rerun": { stdout: "" },
    "run watch": { status: 0 },
    "run view": { stdout: log(["ec2_ssh=ok"]) },
  });
  const c = capture();
  const code = await main(["ec2", "check"], { ...c.io, gh });
  assert.equal(code, 0);
  assert.match(c.out(), /mode: rerun/);
  assert.match(c.out(), /dispatch_refused: HTTP 404: Not Found/);
  assert.match(c.out(), /commit: 5e952bbc/);
  assert.match(c.out(), /merge the workflow file to the default branch/);
});

test("errors print error and code and exit with the right status", async () => {
  const gh = fakeGh({
    "workflow run": {
      status: 4,
      stderr: "To get started with GitHub CLI, please run: gh auth login",
    },
  });
  const c = capture();
  assert.equal(await main(["ec2", "check"], { ...c.io, gh }), 3);
  assert.match(c.err(), /error: .*gh auth login\ncode: AUTH_REQUIRED/);
  assert.match(c.err(), /Set GH_TOKEN/);

  const u = capture();
  assert.equal(await main(["rollout"], { ...u.io, gh }), 2);
  assert.match(u.err(), /code: VALIDATION_ERROR/);

  // A read-only token is refused before GitHub looks at the workflow file.
  const readOnly = fakeGh({
    "workflow run": {
      status: 1,
      stderr:
        "could not create workflow dispatch event: HTTP 403: Resource not accessible by integration",
    },
  });
  const f = capture();
  assert.equal(await main(["ec2", "check"], { ...f.io, gh: readOnly }), 3);
  assert.match(f.err(), /code: FORBIDDEN/);
  assert.match(f.err(), /actions: write/);
});

test("the binary runs and prints help without gh", () => {
  const result = spawnSync(process.execPath, ["bin/ops-axi.js", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, PATH: "/nonexistent" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /usage: ops-axi/);

  const version = spawnSync(process.execPath, ["bin/ops-axi.js", "--version"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

test("a missing gh is reported, not thrown", () => {
  const result = spawnSync(
    process.execPath,
    ["bin/ops-axi.js", "ec2", "check"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, OPS_AXI_GH: "/nonexistent/gh" },
    },
  );
  assert.equal(result.status, 3);
  assert.match(result.stderr, /code: GH_NOT_INSTALLED/);
});
