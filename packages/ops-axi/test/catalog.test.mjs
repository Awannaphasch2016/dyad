import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { HELP, main, parseArgs, resolve } from "../lib/cli.js";
import { OPERATIONS } from "../lib/catalog.js";
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

test("help lists the catalog and leaves walk and cursor factory out", () => {
  assert.match(HELP, /operations\[28\]:/);
  for (const name of [
    "doppler phase1",
    "doppler verify",
    "host status",
    "formula status",
    "preview up <pr>",
    "preview db-status <pr>",
    "vibe status <pr>",
    "bolt status",
    "forma status",
    "toolbox use <digest>",
    "cursor probe",
    "pr open <owner/repo>",
  ]) {
    assert.ok(HELP.includes(name), `help mentions ${name}`);
  }
  assert.equal(/\n  walk dyad /.test(HELP), false);
  assert.equal(/\n  cursor factory /.test(HELP), false);
  assert.match(HELP, /does not rerun an older run/);
  assert.equal(OPERATIONS["cursor factory"], undefined);
  assert.equal(OPERATIONS["walk dyad"], undefined);
});

test("doppler defaults are the pair each command uses today", () => {
  const status = resolve(
    ...Object.values(parseArgs(["preview", "status", "177"])),
  );
  assert.deepEqual(status.fields, [
    "action=status",
    "pr=177",
    "doppler-project=dyad",
    "doppler-config=preview",
  ]);
  assert.equal(status.project, "dyad");
  assert.equal(status.config, "preview");

  const dev = resolve(
    ...Object.values(
      parseArgs([
        "preview",
        "status",
        "177",
        "--project",
        "dyad",
        "--config",
        "dev",
      ]),
    ),
  );
  assert.ok(dev.fields.includes("doppler-config=dev"));
  assert.equal(dev.fields.includes("doppler-config=preview"), false);

  const host = resolve(...Object.values(parseArgs(["host", "status"])));
  assert.deepEqual(host.fields, [
    "doppler-project=dyad",
    "doppler-config=prd",
    "aws-project=aws",
    "aws-config=dev",
  ]);

  const bolt = resolve(...Object.values(parseArgs(["bolt", "status"])));
  assert.deepEqual(bolt.fields, [
    "doppler-project=bolt",
    "doppler-config=preview",
  ]);

  const doppler = resolve(...Object.values(parseArgs(["doppler", "status"])));
  assert.deepEqual(doppler.fields, ["command=status", "doppler-project=dyad"]);
  assert.equal(
    doppler.fields.some((field) => field.startsWith("doppler-config=")),
    false,
  );
});

test("a write with no Doppler default exits before it calls gh", async () => {
  let called = false;
  const gh = async () => {
    called = true;
    throw new Error("gh was called");
  };
  const c = capture();
  assert.equal(await main(["formula", "role"], { ...c.io, gh }), 2);
  assert.match(c.err(), /needs --project and --config/);
  assert.equal(called, false);

  const secrets = capture();
  assert.equal(await main(["preview", "secrets"], { ...secrets.io, gh }), 2);
  assert.equal(called, false);

  const allowed = resolve(
    ...Object.values(
      parseArgs([
        "formula",
        "role",
        "--project",
        "dyad",
        "--config",
        "preview",
      ]),
    ),
  );
  assert.ok(allowed.fields.includes("doppler-project=dyad"));
  assert.ok(allowed.fields.includes("doppler-config=preview"));
});

test("preview up adds the preview label and watches preview.yml", async () => {
  const gh = fakeGh({
    "pr edit": { stdout: "" },
    "pr view": {
      stdout: JSON.stringify({
        headRefName: "cursor/feature",
        url: "https://github.com/Awannaphasch2016/dyad/pull/177",
      }),
    },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run watch": { status: 0 },
    "run view": { stdout: log(["preview=up"]) },
  });
  const c = capture();
  const code = await main(["preview", "up", "177"], { ...c.io, gh });
  assert.equal(code, 0);
  assert.deepEqual(gh.calls[0], [
    "pr",
    "edit",
    "177",
    "--add-label",
    "preview",
  ]);
  assert.match(c.out(), /operation: preview up/);
  assert.match(c.out(), /workflow: preview\.yml/);
  assert.match(c.out(), /mode: label/);
  assert.match(c.out(), /project: dyad/);
  assert.match(c.out(), /config: preview/);
  assert.equal(
    gh.calls.some((call) => call[0] === "workflow"),
    false,
  );
});

test("preview down removes the preview label", async () => {
  const gh = fakeGh({
    "pr edit": { stdout: "" },
    "pr view": {
      stdout: JSON.stringify({ headRefName: "cursor/feature", url: "u" }),
    },
    "run list": { stdout: JSON.stringify([RUN]) },
    "run watch": { status: 0 },
    "run view": { stdout: log(["preview=down"]) },
  });
  const c = capture();
  assert.equal(await main(["preview", "down", "177"], { ...c.io, gh }), 0);
  assert.deepEqual(gh.calls[0], [
    "pr",
    "edit",
    "177",
    "--remove-label",
    "preview",
  ]);
});

test("pr open names the target and does not merge", () => {
  assert.throws(
    () =>
      resolve(
        ...Object.values(parseArgs(["pr", "open", "Awannaphasch2016/forma"])),
      ),
    /--title/,
  );
  const opened = resolve(
    ...Object.values(
      parseArgs([
        "pr",
        "open",
        "Awannaphasch2016/forma",
        "--title",
        "Add status",
        "--head",
        "cursor/status",
      ]),
    ),
  );
  assert.equal(opened.workflow, "pr-open.yml");
  assert.equal(opened.repo, "Awannaphasch2016/dyad");
  assert.ok(opened.fields.includes("target=Awannaphasch2016/forma"));
  assert.ok(opened.fields.includes("head=cursor/status"));
  assert.ok(opened.fields.includes("base=main"));
  assert.equal(
    opened.fields.some((field) => /merge/i.test(field)),
    false,
  );
});

test("pr open's workflow does not merge and the image workflow has no latest tag", () => {
  const root = new URL("../../../.github/workflows/", import.meta.url);
  const opened = readFileSync(new URL("pr-open.yml", root), "utf8");
  assert.equal(opened.includes("pr merge"), false);
  assert.equal(opened.includes("gh pr merge"), false);
  assert.match(opened, /actions\/create-github-app-token/);
  assert.match(opened, /gh pr create/);
  const image = readFileSync(new URL("axi-toolbox-image.yml", root), "utf8");
  assert.equal(image.includes(":latest"), false);
  assert.match(image, /echo "image=\$\{IMAGE\}@\$\{DIGEST\}"/);
  const forma = readFileSync(
    new URL("../workflows/forma-status.yml", import.meta.url),
    "utf8",
  );
  assert.equal(forma.includes("deploy"), true);
  assert.equal(/vercel deploy|gh pr create|pr merge/.test(forma), false);
});

test("toolbox use copies the binaries and writes the pin", async () => {
  const root = await mkdtemp(join(tmpdir(), "ops-axi-"));
  const binDir = join(root, "bin");
  const pinPath = join(root, "pin");
  const digest = `sha256:${"ab".repeat(32)}`;
  const calls = [];
  const docker = async (args) => {
    calls.push(args);
    if (args[0] === "create") return { status: 0, stdout: "cid\n", stderr: "" };
    if (args[0] === "cp") {
      await writeFile(args[2], "#!/bin/sh\necho ok\n");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "rm") return { status: 0, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
  };
  const c = capture();
  const code = await main(["toolbox", "use", digest], {
    ...c.io,
    binDir,
    pinPath,
    docker,
  });
  assert.equal(code, 0, c.err());
  assert.equal(await readFile(pinPath, "utf8"), `${digest}\n`);
  assert.match(await readFile(join(binDir, "ops-axi"), "utf8"), /echo ok/);
  assert.match(await readFile(join(binDir, "gh-axi"), "utf8"), /echo ok/);
  assert.deepEqual(calls[0].slice(0, 2), [
    "create",
    `ghcr.io/awannaphasch2016/axi-toolbox@${digest}`,
  ]);
  assert.equal(calls.at(-1)[0], "rm");
  assert.match(c.out(), new RegExp(`pin: ${pinPath}`));
});
