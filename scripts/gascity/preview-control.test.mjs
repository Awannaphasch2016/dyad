import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const control = readFileSync(
  new URL("./preview-control.sh", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../.github/workflows/preview-control.yml", import.meta.url),
  "utf8",
);
const imageWorkflow = readFileSync(
  new URL(
    "../../.github/workflows/wewebplus-preview-image.yml",
    import.meta.url,
  ),
  "utf8",
);
const previewUp = readFileSync(
  new URL("./preview-up.sh", import.meta.url),
  "utf8",
);

test("preview control resumes one pull request without the skip argument", () => {
  const resume = control.slice(
    control.indexOf("resume)"),
    control.indexOf("status)"),
  );
  assert.match(resume, /PREVIEW_RESUME_ONLY/);
  assert.match(resume, /bash scripts\/gascity\/preview-resume\.sh\n/);
  assert.equal(resume.includes('preview-resume.sh "$pr"'), false);
  assert.equal(control.includes("docker build"), false);
  assert.equal(control.includes("Dockerfile"), false);
});

test("preview control destroy resumes others before it removes the preview", () => {
  const destroy = control.slice(control.indexOf("destroy)"));
  assert.ok(
    destroy.indexOf('preview-resume.sh "$pr"') <
      destroy.indexOf("controller.mjs destroy"),
  );
  assert.ok(
    destroy.indexOf("tunnel-token") < destroy.indexOf("compose.preview.yml"),
  );
  assert.match(destroy, /result=already_absent/);
  assert.match(control, /\/opt\/gascity\/weaver-plus/);
});

test("preview control workflow does not build an image", () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /preview-devbox-wewebplus-ci/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /namespacelabs\/nscloud-setup@v0/);
  assert.match(workflow, /devbox exec Wewebplus-ci/);
  assert.match(workflow, /preview-control\.sh/);
  assert.equal(workflow.includes("docker build"), false);
  assert.equal(workflow.includes("Dockerfile.gascity"), false);
  assert.equal(workflow.includes("13.251.216.187"), false);
  assert.equal(workflow.includes("DOPPLER_TOKEN"), false);
});

test("the preview CLI image workflow is separate from the Dyad image", () => {
  assert.match(imageWorkflow, /packages\/wewebplus-preview/);
  assert.match(imageWorkflow, /:sha-\$\{SHA\}/);
  assert.equal(imageWorkflow.includes("Dockerfile.gascity"), false);
});

test("preview-up prints one result line and records an unhealthy gc", () => {
  assert.match(
    previewUp,
    /preview_result pr=\$\{pr\} action=up url=\$\{preview_url\} http=\$\{code\} bridge=\$\{bridge\} tunnel=\$\{tunnel_kind\} gc=\$\{gc_state\}/,
  );
  assert.match(previewUp, /gc_state=unhealthy/);
});
