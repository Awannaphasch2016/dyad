import test from "node:test";
import assert from "node:assert/strict";
import { parseResultLines, redact, startRun } from "../lib/run.js";
import { fakeGh, RUN, log } from "./fake_gh.mjs";

const noSleep = async () => {};
const now = () => Date.parse("2026-10-09T10:00:00Z");

test("result lines are read from a gh log and secrets are redacted", () => {
  const results = parseResultLines(
    log([
      "github_ec2_ssh_key=present fingerprint=SHA256:abc",
      "github_doppler_token=http-200 project=dyad config=preview",
      "AWS_PREVIEW_FORMULA_ROLE_ARN=present",
      "EC2_SSH_KEY=-----BEGIN OPENSSH PRIVATE KEY-----",
      "url=http://formula.example.elb.amazonaws.com",
      "##[group]Run set -euo pipefail",
      '\u001b[36;1mecho "url=echoed-source"\u001b[0m',
      "::add-mask::arn:aws:iam::123:role/x",
      "not a result line",
    ]),
  );
  assert.equal(
    results.get("github_ec2_ssh_key"),
    "present fingerprint=SHA256:abc",
  );
  assert.equal(
    results.get("github_doppler_token"),
    "http-200 project=dyad config=preview",
  );
  assert.equal(results.get("AWS_PREVIEW_FORMULA_ROLE_ARN"), "present");
  assert.equal(results.get("EC2_SSH_KEY"), "<redacted>");
  assert.equal(results.get("url"), "http://formula.example.elb.amazonaws.com");
  assert.equal(results.size, 5);
});

test("redact keeps status words and hides anything else under a secret-looking key", () => {
  assert.equal(redact("DOPPLER_TOKEN", "absent"), "absent");
  assert.equal(
    redact("dyad_token", "http-401 project=dyad config=prd"),
    "http-401 project=dyad config=prd",
  );
  assert.equal(redact("AWS_PREVIEW_FORMULA_ROLE_ARN", "stored"), "stored");
  assert.equal(redact("GH_TOKEN", "ghp_abcdef"), "<redacted>");
  assert.equal(redact("role_arn", "arn:aws:iam::1:role/x"), "<redacted>");
  assert.equal(redact("url", "http://x"), "http://x");
});

test("a successful dispatch finds the run created after the request", async () => {
  const gh = fakeGh({
    "workflow run": { stdout: "" },
    "run list": (args, calls) => ({
      stdout: JSON.stringify(
        calls.length < 3
          ? [{ ...RUN, databaseId: 1, createdAt: "2026-10-09T09:00:00Z" }]
          : [RUN, { ...RUN, databaseId: 1, createdAt: "2026-10-09T09:00:00Z" }],
      ),
    }),
  });
  const started = await startRun(gh, {
    workflow: "ec2-access-check.yml",
    ref: "main",
    fields: ["hours=3"],
    sleep: noSleep,
    now,
  });
  assert.equal(started.mode, "dispatch");
  assert.equal(started.run.databaseId, 4242);
  assert.deepEqual(gh.calls[0], [
    "workflow",
    "run",
    "ec2-access-check.yml",
    "--ref",
    "main",
    "-f",
    "hours=3",
  ]);
  assert.ok(gh.calls[1].includes("--event"), "polls dispatch runs only");
});

test("a refused dispatch fails and does not list or rerun older runs", async () => {
  const gh = fakeGh({
    "workflow run": {
      status: 1,
      stderr:
        "could not find any workflows named ec2-access-check.yml\nHTTP 404: Not Found",
    },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run rerun": { stdout: "" },
  });
  await assert.rejects(
    startRun(gh, {
      workflow: "ec2-access-check.yml",
      ref: "cursor/x",
      sleep: noSleep,
      now,
    }),
    (error) =>
      error.code === "DISPATCH_REFUSED" &&
      /does not rerun an older run/.test(error.message),
  );
  assert.deepEqual(
    gh.calls.map((call) => call.slice(0, 2).join(" ")),
    ["workflow run"],
  );
});

test("a workflow without workflow_dispatch is a refused dispatch", async () => {
  const gh = fakeGh({
    "workflow run": {
      status: 1,
      stderr: "HTTP 422: Workflow does not have 'workflow_dispatch' trigger",
    },
  });
  await assert.rejects(
    startRun(gh, { workflow: "x.yml", ref: "b", sleep: noSleep, now }),
    (error) => error.code === "DISPATCH_REFUSED",
  );
});

test("an auth failure is not treated as a refusal", async () => {
  const gh = fakeGh({
    "workflow run": {
      status: 4,
      stderr: "To get started with GitHub CLI, please run: gh auth login",
    },
  });
  await assert.rejects(
    startRun(gh, { workflow: "x.yml", ref: "b", sleep: noSleep, now }),
    (error) => error.code === "AUTH_REQUIRED",
  );
});
