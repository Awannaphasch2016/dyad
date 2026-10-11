// Preview database identity for one orchestrator pull request.
// This module does not call Neon.

export const FORMA_NEON_PROJECT_ID = "divine-credit-21002460";
export const FORMA_PARENT_BRANCH_ID = "br-round-night-b33xeq5p";

const refused = [
  "proud-salad-68182047",
  "ep-young-wave-b3cwe0rz",
  "mute-credit-71067312",
  "br-mute-shadow-b3jxqoho",
  "forma-pr-",
];

const refusedHosts = ["wewebplus-ci", "weaver-plus"];

export function formaPreviewBranchName(pr) {
  if (!/^[0-9]+$/.test(String(pr))) {
    throw new Error("Pull request number must be digits");
  }
  return `preview-forma-${pr}`;
}

export function assertFormaPreviewTarget({
  projectId,
  parentId,
  branchName,
} = {}) {
  const text = `${projectId} ${parentId} ${branchName}`;
  for (const marker of refused) {
    if (text.includes(marker)) {
      throw new Error(
        "Refusing a Dyad, production, or Forma pull-request database",
      );
    }
  }
  if (projectId !== FORMA_NEON_PROJECT_ID) {
    throw new Error("Refusing a Neon project other than forma");
  }
  if (parentId !== FORMA_PARENT_BRANCH_ID) {
    throw new Error("Refusing a parent other than the Forma root branch");
  }
  if (branchName === parentId) {
    throw new Error("Refusing to delete the parent branch");
  }
  if (!/^preview-forma-[0-9]+$/.test(String(branchName))) {
    throw new Error("Refusing a branch other than preview-forma-<number>");
  }
  return { projectId, parentId, branchName };
}

export function assertDockerHost(host) {
  const value = String(host ?? "").trim();
  if (!value) throw new Error("PREVIEW_FORMA_DOCKER_HOST is not set");
  const lower = value.toLowerCase();
  for (const marker of refusedHosts) {
    if (lower.includes(marker)) {
      throw new Error("Refusing the Dyad preview host");
    }
  }
  return value;
}
