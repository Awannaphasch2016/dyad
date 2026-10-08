import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { commandForFormaPreview } from "./command.mjs";
import {
  manifestUrl,
  parseCompose,
  pinnedImages,
  readPinnedImages,
} from "./compose.mjs";
import { assertPreviewHost } from "./host.mjs";
import {
  decideFromEnv,
  planDown,
  registryTokenUrl,
  resolveManifest,
} from "./run.mjs";
import {
  assertDockerHost,
  assertFormaPreviewTarget,
  formaPreviewBranchName,
} from "./target.mjs";

const sha = "80a8e419f6285378b4dfada336ea8213f3089bab";
const formaImage = `ghcr.io/awannaphasch2016/forma:sha-${sha}`;

test("preview-forma ignores the Dyad preview label and unlabeled closes", () => {
  assert.equal(
    commandForFormaPreview({
      action: "labeled",
      label: "preview-forma",
      labels: ["preview-forma"],
    }),
    "update",
  );
  assert.equal(
    commandForFormaPreview({
      action: "synchronize",
      labels: ["preview-forma"],
    }),
    "update",
  );
  assert.equal(
    commandForFormaPreview({
      action: "unlabeled",
      label: "preview-forma",
      labels: [],
    }),
    "destroy",
  );
  assert.equal(
    commandForFormaPreview({
      action: "closed",
      labels: ["preview-forma"],
      closed: true,
    }),
    "destroy",
  );
  assert.equal(
    commandForFormaPreview({
      action: "closed",
      labels: ["preview"],
      closed: true,
    }),
    "skip",
  );
  assert.equal(
    commandForFormaPreview({
      action: "synchronize",
      labels: ["preview"],
    }),
    "skip",
  );
  assert.equal(
    commandForFormaPreview({
      action: "labeled",
      label: "preview",
      labels: ["preview"],
    }),
    "skip",
  );
  assert.equal(
    commandForFormaPreview({
      action: "labeled",
      label: "preview-forma",
      labels: ["preview-forma"],
      closed: true,
    }),
    "skip",
  );
});

test("a dispatch in this repository updates one numeric pull request", () => {
  assert.deepEqual(decideFromEnv({ EVENT: "workflow_dispatch", PR: "81" }), {
    command: "update",
    pr: "81",
  });
  assert.throws(
    () => decideFromEnv({ EVENT: "workflow_dispatch", PR: "" }),
    /digits/,
  );
});

test("compose pins published images and rejects a build", () => {
  const images = pinnedImages({
    services: {
      forma: { image: formaImage },
      worker: {
        image: `ghcr.io/awannaphasch2016/forma@sha256:${"ab".repeat(32)}`,
      },
    },
  });
  assert.equal(images.length, 2);
  assert.equal(images[0].repository, "forma");
  assert.match(manifestUrl(formaImage), /\/forma\/manifests\/sha-80a8e419/);
  assert.throws(
    () =>
      pinnedImages({
        services: { forma: { image: formaImage, build: "." } },
      }),
    /must not build/,
  );
  assert.throws(
    () =>
      pinnedImages({
        services: {
          forma: { image: "ghcr.io/awannaphasch2016/forma:latest" },
        },
      }),
    /must pin/,
  );
  const committed = readFileSync(
    new URL("./compose.yml", import.meta.url),
    "utf8",
  );
  assert.match(committed, new RegExp(sha));
  assert.equal(committed.includes("build:"), false);
  assert.throws(
    () => parseCompose("services:\n  forma:\n    - broken\n"),
    /unsupported/,
  );
});

test("a public image digest is read with a registry pull token", async () => {
  const digest = `sha256:${"ab".repeat(32)}`;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, authorization: options.headers?.Authorization || "" });
    if (url.startsWith("https://ghcr.io/token")) {
      if (options.headers?.Authorization) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "pull-token" }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name === "docker-content-digest" ? digest : "";
        },
      },
    };
  };
  assert.match(
    registryTokenUrl(formaImage),
    /repository%3Aawannaphasch2016%2Fforma%3Apull/,
  );
  assert.equal(
    await resolveManifest(formaImage, "github-app-token", fetchImpl),
    digest,
  );
  assert.equal(calls[0].authorization, "Bearer github-app-token");
  assert.equal(calls[1].authorization, "");
  assert.equal(calls[2].authorization, "Bearer pull-token");
  assert.match(calls[2].url, /\/forma\/manifests\/sha-80a8e419/);
});

test("the committed compose file parses without a package install", async () => {
  const images = await readPinnedImages(
    fileURLToPath(new URL("./compose.yml", import.meta.url)),
  );
  assert.equal(images.length, 1);
  assert.equal(images[0].service, "forma");
  assert.equal(images[0].image, formaImage);
});

test("cleanup names only this pull request and refuses the known hosts", () => {
  assert.equal(formaPreviewBranchName(81), "preview-forma-81");
  assert.throws(() => formaPreviewBranchName("2-extra"), /digits/);
  assert.equal(
    assertFormaPreviewTarget({
      projectId: "divine-credit-21002460",
      parentId: "br-round-night-b33xeq5p",
      branchName: "preview-forma-81",
    }).branchName,
    "preview-forma-81",
  );
  assert.throws(
    () =>
      assertFormaPreviewTarget({
        projectId: "proud-salad-68182047",
        parentId: "br-round-night-b33xeq5p",
        branchName: "preview-forma-81",
      }),
    /Refusing/,
  );
  assert.throws(
    () =>
      assertFormaPreviewTarget({
        projectId: "divine-credit-21002460",
        parentId: "br-round-night-b33xeq5p",
        branchName: "forma-pr-2",
      }),
    /Refusing/,
  );
  assert.throws(
    () => assertDockerHost("wewebplus-ci.example"),
    /Dyad preview host/,
  );
  assert.throws(() => assertDockerHost(""), /not set/);
  assert.deepEqual(planDown({ PR: "81", PREVIEW_FORMA_DOCKER_HOST: "" }), {
    action: "skip",
    projectId: "divine-credit-21002460",
    parentId: "br-round-night-b33xeq5p",
    branchName: "preview-forma-81",
  });
});

test("the recorded host is the Fargate load balancer and the task stays stopped", () => {
  const host = JSON.parse(
    readFileSync(new URL("./host.json", import.meta.url), "utf8"),
  );
  assert.equal(assertPreviewHost(host).started, false);
  assert.equal(
    host.albDns,
    "preview-forma-2018533952.ap-southeast-1.elb.amazonaws.com",
  );
  assert.throws(
    () => assertPreviewHost({ ...host, started: true }),
    /stay stopped/,
  );
  assert.throws(
    () =>
      assertPreviewHost({
        ...host,
        albDns: "wewebplus-ci.ap-southeast-1.elb.amazonaws.com",
      }),
    /Dyad preview host/,
  );
});

test("the workflow starts one task on the recorded host", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview-forma.yml", import.meta.url),
    "utf8",
  );
  const launch = readFileSync(new URL("./launch.mjs", import.meta.url), "utf8");
  assert.match(workflow, /name: preview-forma/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permission-packages: read/);
  assert.match(workflow, /launch\.mjs up/);
  assert.match(workflow, /launch\.mjs down/);
  assert.match(workflow, /set \+x/);
  assert.match(workflow, /DOPPLER_ADMIN_TOKEN/);
  assert.match(launch, /project=forma&config=dev/);
  assert.match(launch, /project=aws&config=dev/);
  assert.equal(workflow.includes("permission-packages: write"), false);
  assert.equal(workflow.includes("wewebplus-ci"), false);
  assert.equal(workflow.includes("docker compose"), false);
  assert.equal(workflow.includes("dyad/prd"), false);
  assert.equal(launch.includes("dyad/prd"), false);
  const skipped = spawnSync(
    process.execPath,
    ["deploy/preview-forma/run.mjs", "check"],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, GH_TOKEN: "", PREVIEW_FORMA_DOCKER_HOST: "" },
      encoding: "utf8",
    },
  );
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /preview_forma_image=forma/);
  assert.match(
    skipped.stdout,
    /preview_forma_host=preview-forma-2018533952.ap-southeast-1.elb.amazonaws.com/,
  );
  assert.match(skipped.stdout, /preview_forma_task=not_started/);
  const down = spawnSync(
    process.execPath,
    ["deploy/preview-forma/run.mjs", "down"],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: { ...process.env, PR: "81", PREVIEW_FORMA_DOCKER_HOST: "" },
      encoding: "utf8",
    },
  );
  assert.equal(down.status, 0);
  assert.match(down.stdout, /preview_forma_down=skipped task=not_started/);
});
