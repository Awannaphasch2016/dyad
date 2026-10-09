// Checks the toolbox files that do not need Docker: the publish workflow, the
// pin file, and the shell scripts. docker/axi/toolbox.test.sh covers the image.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );

test("tools.env pins exact versions", () => {
  const env = read("./tools.env");
  assert.match(env, /^GH_VERSION=\d+\.\d+\.\d+$/m);
  assert.match(env, /^GH_AXI_VERSION=\d+\.\d+\.\d+$/m);
});

test("the publish workflow only builds and pushes the image", () => {
  const workflow = read("../../.github/workflows/axi-toolbox-image.yml");

  assert.match(workflow, /name: AXI toolbox image/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /paths:\n\s+- docker\/axi\/\*\*/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /group: axi-toolbox-image/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /bash docker\/axi\/toolbox\.test\.sh/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /:sha-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /echo "image=\$\{IMAGE\}@\$\{DIGEST\}"/);

  for (const forbidden of [
    "id-token",
    "DOPPLER_TOKEN",
    "EC2_SSH_KEY",
    "13.251.216.187",
    "devbox",
    "gascity-rollout",
    "gh workflow run",
    ":latest",
  ]) {
    assert.equal(
      workflow.includes(forbidden),
      false,
      `workflow must not contain ${forbidden}`,
    );
  }

  const testStep = workflow.indexOf("Test the image");
  const loginStep = workflow.indexOf("Log in to GHCR");
  assert.ok(testStep > 0 && loginStep > testStep, "tests run before login");
});

test("the Dockerfile has no credentials and runs as agent", () => {
  const dockerfile = read("./Dockerfile");
  assert.match(dockerfile, /^USER agent$/m);
  assert.match(dockerfile, /useradd --create-home --uid 10001/);
  assert.match(
    dockerfile,
    /npm install -g --prefix \/opt\/axi --ignore-scripts/,
  );
  assert.match(dockerfile, /sha256sum -c/);
  assert.match(dockerfile, /gh-axi setup hooks/);
  assert.match(dockerfile, /ENTRYPOINT \["\/opt\/axi\/entrypoint\.sh"\]/);
  const instructions = dockerfile
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  for (const forbidden of ["GH_TOKEN", "GITHUB_TOKEN", "DOPPLER_TOKEN"]) {
    assert.equal(
      instructions.includes(forbidden),
      false,
      `Dockerfile instructions must not mention ${forbidden}`,
    );
  }
});

test("the shell scripts parse", () => {
  for (const script of [
    "docker/axi/entrypoint.sh",
    "docker/axi/toolbox.test.sh",
    "docker/axi/ops-axi-stub.sh",
  ]) {
    const result = spawnSync("bash", ["-n", script], {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test("the stub prints a not-installed message and exits 0", () => {
  const result = spawnSync("sh", ["docker/axi/ops-axi-stub.sh", "--help"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /not installed in this image/);
});
