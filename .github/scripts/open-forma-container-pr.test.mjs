import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FORMA_BRANCH,
  FORMA_REPOSITORY,
  assertSafeText,
  planFormaContainer,
  pullRequestCopy,
  redact,
} from "./open-forma-container-pr.mjs";

const gascityDockerfile = "FROM node:24-bookworm\nCOPY package.json ./\n";
const entrypoint = "#!/usr/bin/env bash\necho ready\n";

test("the opener targets the forma repository and the harness app", () => {
  const workflow = readFileSync(
    new URL("../workflows/open-forma-container-pr.yml", import.meta.url),
    "utf8",
  );
  assert.equal(FORMA_REPOSITORY, "Awannaphasch2016/forma");
  assert.equal(FORMA_BRANCH, "cursor/forma-container-5014");
  assert.match(workflow, /repositories: forma/);
  assert.match(workflow, /permission-contents: write/);
  assert.match(workflow, /permission-pull-requests: write/);
  assert.match(workflow, /secrets\.DYAD_GITHUB_APP_PEM_KEY/);
  assert.match(workflow, /environment: ai-bots/);
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/cursor\/forma-container-pr-5014'/,
  );
  assert.equal(workflow.includes("bolt.diy"), false);
  for (const marker of [
    "proud-salad",
    "ep-young-wave",
    "mute-credit",
    "ep-wild-paper",
    "/opt/gascity/weaver-plus",
  ]) {
    assert.equal(workflow.includes(marker), false);
    assert.throws(() => assertSafeText(`container ${marker}`), /Refusing/);
  }
});

test("an empty forma repo receives the dev container", () => {
  const plan = planFormaContainer({
    entries: [],
    gascityDockerfile,
    entrypoint,
  });
  assert.equal(plan.kind, "dev-stage");
  const paths = plan.files.map((file) => file.path).sort();
  assert.deepEqual(paths, [
    ".dockerignore",
    "Dockerfile",
    "compose.dev.yml",
    "docker/gascity-entrypoint.sh",
  ]);
  const dockerfile = plan.files.find((file) => file.path === "Dockerfile");
  assert.equal(dockerfile.contents, gascityDockerfile);
  const compose = plan.files.find((file) => file.path === "compose.dev.yml");
  assert.match(compose.contents, /DYAD_BROWSER_BRIDGE: "1"/);
  assert.equal(compose.contents.includes("NOVNC_PASSWORD"), false);
});

test("a node app gets a lockfile install and does not replace a Dockerfile", () => {
  const created = planFormaContainer({
    entries: ["package.json", "pnpm-lock.yaml"],
    packageJson: { name: "forma", scripts: { dev: "vite" } },
    gascityDockerfile,
    entrypoint,
  });
  assert.equal(created.kind, "node-app");
  const dockerfile = created.files.find((file) => file.path === "Dockerfile");
  assert.match(dockerfile.contents, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile.contents, /npm", "run", "dev"/);

  const existing = planFormaContainer({
    entries: ["package.json", "Dockerfile", "compose.dev.yml"],
    packageJson: { name: "forma", scripts: { start: "node server.js" } },
    gascityDockerfile,
    entrypoint,
  });
  assert.deepEqual(existing.files, []);
});

test("a dyad checkout only gains the dev compose file", () => {
  const plan = planFormaContainer({
    entries: ["package.json", "Dockerfile.gascity"],
    packageJson: { name: "dyad", scripts: { start: "electron" } },
    gascityDockerfile,
    entrypoint,
  });
  assert.equal(plan.kind, "dyad-dev-compose");
  assert.deepEqual(
    plan.files.map((file) => file.path),
    ["compose.dev.yml"],
  );
  assert.match(pullRequestCopy(plan.kind).body, /does not deploy/);
});

test("redact removes the app token from errors", () => {
  const token = "ghs_exampletokenvalue";
  const text = redact(
    `push failed https://x-access-token:${token}@github.com`,
    [token],
  );
  assert.equal(text.includes(token), false);
  assert.match(text, /\[redacted\]/);
});
