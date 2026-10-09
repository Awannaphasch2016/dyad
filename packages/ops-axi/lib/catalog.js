// The operations this CLI exposes. Each one is an existing workflow file.
// The CLI adds nothing to the workflow; it only starts, waits, and reports.

export const DEFAULT_REPO = "Awannaphasch2016/dyad";

export const OPERATIONS = {
  "ec2 check": {
    workflow: "ec2-access-check.yml",
    defaultRef: "cursor/axi-toolbox-image-plan-531e",
    summary:
      "Prove GitHub Actions can reach the EC2 host and that the host's Doppler tokens work",
    verify: [],
  },
  "formula role": {
    workflow: "preview-formula-role.yml",
    defaultRef: "cursor/formula-config-ui-55d6",
    summary:
      "Create the GitHub OIDC role for the formula preview from the EC2 host and store its ARN in Doppler",
    verify: [],
  },
  "formula verify": {
    workflow: "ec2-access-check.yml",
    defaultRef: "cursor/axi-toolbox-image-plan-531e",
    summary:
      "Check from the EC2 host that AWS_PREVIEW_FORMULA_ROLE_ARN exists in Doppler",
    verify: [{ key: "AWS_PREVIEW_FORMULA_ROLE_ARN", expect: "present" }],
  },
  "formula deploy": {
    workflow: "preview-formula.yml",
    defaultRef: "cursor/formula-config-ui-55d6",
    summary: "Deploy the formula preview to ECS and print its URL",
    verify: [{ key: "url", expect: /^https?:\/\// }],
  },
  "doppler status": {
    workflow: "doppler-organize.yml",
    defaultRef: "cursor/axi-toolbox-image-plan-531e",
    summary:
      "Log in to Doppler by OIDC from GitHub Actions and report the dyad environments against deploy/doppler/manifest.json",
    verify: [{ key: "doppler_oidc", expect: /^http-200/ }],
  },
  rollout: {
    workflow: "gascity-rollout.yml",
    defaultRef: "cursor/browser-dyad-ui-bbea",
    summary: "Roll the Gas City EC2 host forward to a commit after CI passes",
    positional: {
      name: "sha",
      field: "commit",
      pattern: /^[0-9a-fA-F]{7,40}$/,
    },
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
