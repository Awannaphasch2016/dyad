// The operations this CLI exposes. Each one names the repository that owns
// the workflow. The CLI adds nothing to the workflow; it starts, waits, and
// reports.
//
// Awannaphasch2016/ops-axi is the repository this catalog is moving to. This
// token cannot create that repository (createRepository returns 403), so the
// toolbox and pull-request workflows still live in Awannaphasch2016/dyad and
// the entries below name that repository.

export const DYAD_REPO = "Awannaphasch2016/dyad";
export const OPS_AXI_REPO = "Awannaphasch2016/ops-axi";
export const FORMA_REPO = "Awannaphasch2016/forma";

const AXI = "cursor/axi-toolbox-image-plan-531e";
const FORMULA = "cursor/formula-config-ui-55d6";
const HOST = "cursor/browser-dyad-ui-bbea";
const COMMANDS = "cursor/ops-axi-commands-f1a5";
const PROBE = "cursor/gascity-consolidation-step-f1a5";

const dyadPreview = { project: "dyad", config: "preview" };
const dyadPrd = {
  project: "dyad",
  config: "prd",
  awsProject: "aws",
  awsConfig: "dev",
};
const probePair = {
  project: "dyad",
  config: "preview",
  awsProject: "aws",
  awsConfig: "dev",
};

export const OPERATIONS = {
  "ec2 check": {
    repo: DYAD_REPO,
    workflow: "ec2-access-check.yml",
    defaultRef: AXI,
    summary:
      "Prove GitHub Actions can reach the EC2 host and that the host's Doppler tokens work",
    doppler: dyadPreview,
    verify: [],
  },
  "formula role": {
    repo: DYAD_REPO,
    workflow: "preview-formula-role.yml",
    defaultRef: FORMULA,
    summary:
      "Create the GitHub OIDC role for the formula preview from the EC2 host and store its ARN in Doppler",
    writes: true,
    requiresDoppler: true,
    verify: [],
  },
  "formula verify": {
    repo: DYAD_REPO,
    workflow: "ec2-access-check.yml",
    defaultRef: AXI,
    summary:
      "Check from the EC2 host that AWS_PREVIEW_FORMULA_ROLE_ARN exists in Doppler",
    doppler: dyadPreview,
    verify: [{ key: "AWS_PREVIEW_FORMULA_ROLE_ARN", expect: "present" }],
  },
  "formula deploy": {
    repo: DYAD_REPO,
    workflow: "preview-formula.yml",
    defaultRef: FORMULA,
    summary: "Deploy the formula preview to ECS and print its URL",
    writes: true,
    doppler: dyadPreview,
    verify: [{ key: "url", expect: /^https?:\/\// }],
  },
  "formula status": {
    repo: DYAD_REPO,
    workflow: "formula-status.yml",
    defaultRef: COMMANDS,
    summary:
      "Print the formula ECS service, desired count, task health, and URL",
    doppler: dyadPreview,
    verify: [],
  },
  "doppler status": {
    repo: DYAD_REPO,
    workflow: "doppler-organize.yml",
    defaultRef: AXI,
    summary:
      "Log in to Doppler by OIDC from GitHub Actions and report the dyad environments against deploy/doppler/manifest.json",
    doppler: { project: "dyad" },
    fixed: ["command=status"],
    verify: [{ key: "doppler_oidc", expect: /^http-200/ }],
  },
  "doppler phase1": {
    repo: DYAD_REPO,
    workflow: "doppler-organize.yml",
    defaultRef: AXI,
    summary: "Copy manifest names into the ci and prd configs",
    writes: true,
    doppler: { project: "dyad" },
    fixed: ["command=phase1"],
    verify: [],
  },
  "doppler verify": {
    repo: DYAD_REPO,
    workflow: "doppler-organize.yml",
    defaultRef: AXI,
    summary: "Check that the ci and prd copy matches the manifest",
    doppler: { project: "dyad" },
    fixed: ["command=verify"],
    verify: [],
  },
  rollout: {
    repo: DYAD_REPO,
    workflow: "gascity-rollout.yml",
    defaultRef: HOST,
    summary: "Roll the Gas City EC2 host forward to a commit after CI passes",
    writes: true,
    doppler: dyadPrd,
    positional: {
      name: "sha",
      field: "commit",
      pattern: /^[0-9a-fA-F]{7,40}$/,
    },
    verify: [],
  },
  "host status": {
    repo: DYAD_REPO,
    workflow: "host-status.yml",
    defaultRef: COMMANDS,
    summary: "Print the commit the EC2 host is running",
    doppler: dyadPrd,
    verify: [],
  },
  "preview image": {
    repo: DYAD_REPO,
    workflow: "preview-image.yml",
    defaultRef: AXI,
    summary: "Publish the Dyad image and update the shared preview",
    writes: true,
    doppler: dyadPreview,
    verify: [],
  },
  "preview up": {
    repo: DYAD_REPO,
    kind: "label",
    labelAction: "add",
    workflow: "preview.yml",
    summary: "Add the preview label and watch preview.yml",
    writes: true,
    doppler: dyadPreview,
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "preview down": {
    repo: DYAD_REPO,
    kind: "label",
    labelAction: "remove",
    workflow: "preview.yml",
    summary: "Remove the preview label and watch preview.yml",
    writes: true,
    doppler: dyadPreview,
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "preview exec": {
    repo: DYAD_REPO,
    workflow: "preview-exec.yml",
    defaultRef: AXI,
    summary: "Prove GitHub can run a preview on the Devbox",
    writes: true,
    doppler: dyadPreview,
    verify: [],
  },
  "preview wake": {
    repo: DYAD_REPO,
    workflow: "preview-wake.yml",
    defaultRef: AXI,
    summary: "Start preview containers after cloudflared stops",
    writes: true,
    doppler: dyadPreview,
    verify: [],
  },
  "preview secrets": {
    repo: DYAD_REPO,
    workflow: "preview-secrets.yml",
    defaultRef: AXI,
    summary: "Seal the Devbox controller key",
    writes: true,
    requiresDoppler: true,
    verify: [],
  },
  "preview status": {
    repo: DYAD_REPO,
    workflow: "preview-control.yml",
    defaultRef: COMMANDS,
    summary: "Print Devbox preview container state",
    doppler: dyadPreview,
    fixed: ["action=status"],
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "preview logs": {
    repo: DYAD_REPO,
    workflow: "preview-control.yml",
    defaultRef: COMMANDS,
    summary: "Print recent Devbox preview logs",
    doppler: dyadPreview,
    fixed: ["action=logs"],
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "preview db-status": {
    repo: DYAD_REPO,
    workflow: "preview-control.yml",
    defaultRef: COMMANDS,
    summary: "Print whether the preview Neon branch is present",
    doppler: dyadPreview,
    fixed: ["action=db-status"],
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "vibe status": {
    repo: DYAD_REPO,
    workflow: "vibe-status.yml",
    defaultRef: COMMANDS,
    summary: "Print the HTTP status of the Vibe SDK preview worker",
    doppler: dyadPreview,
    positional: { name: "pr", field: "pr", pattern: /^[0-9]+$/ },
    verify: [],
  },
  "bolt status": {
    repo: DYAD_REPO,
    workflow: "bolt-status.yml",
    defaultRef: COMMANDS,
    summary: "Print the HTTP status of bolt-walkthrough-55d6",
    doppler: { project: "bolt", config: "preview" },
    verify: [],
  },
  "forma status": {
    repo: FORMA_REPO,
    workflow: "forma-status.yml",
    defaultRef: "main",
    summary: "Print the latest Forma deployment state",
    verify: [],
  },
  "toolbox image": {
    repo: DYAD_REPO,
    workflow: "axi-toolbox-image.yml",
    defaultRef: COMMANDS,
    summary:
      "Build and push ghcr.io/awannaphasch2016/axi-toolbox. No latest tag",
    verify: [{ key: "image", expect: /^ghcr\.io\/.+@sha256:[0-9a-f]{64}$/ }],
  },
  "toolbox status": {
    repo: DYAD_REPO,
    workflow: "toolbox-status.yml",
    defaultRef: COMMANDS,
    summary: "Print the published toolbox digest and tag",
    verify: [],
  },
  "toolbox use": {
    kind: "toolbox-use",
    repo: DYAD_REPO,
    summary:
      "Install ops-axi and gh-axi from an image digest and write the pin",
    positional: {
      name: "digest",
      field: "digest",
      pattern: /^sha256:[0-9a-f]{64}$/,
    },
    verify: [],
  },
  "cursor probe": {
    repo: DYAD_REPO,
    workflow: "hitl-cursor-probe.yml",
    defaultRef: PROBE,
    summary: "GET /v1/me, then one plan-mode agent that the job deletes",
    doppler: probePair,
    verify: [],
  },
  "pr open": {
    repo: DYAD_REPO,
    workflow: "pr-open.yml",
    defaultRef: COMMANDS,
    summary:
      "Open a pull request on another repository through the GitHub App. Does not merge",
    writes: true,
    positional: {
      name: "owner/repo",
      field: "target",
      pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    },
    needsTitle: true,
    verify: [],
  },
};

export function findOperation(words) {
  const two = words.slice(0, 2).join(" ");
  if (OPERATIONS[two])
    return { name: two, op: OPERATIONS[two], rest: words.slice(2) };
  const one = words[0];
  if (OPERATIONS[one])
    return { name: one, op: OPERATIONS[one], rest: words.slice(1) };
  return null;
}
