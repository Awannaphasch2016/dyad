// Label decisions for a preview that runs pinned images. The Dyad `preview`
// label is a different workflow. Closing a pull request that never had
// `preview-forma` does not destroy anything.

export const FORMA_PREVIEW_LABEL = "preview-forma";

export function commandForFormaPreview(event = {}) {
  const action = String(event.action || "");
  const label = String(event.label || "");
  const labels = new Set(event.labels || []);
  const closed = Boolean(event.closed) || action === "closed";

  if (action === "labeled" && label === FORMA_PREVIEW_LABEL && closed) {
    return "skip";
  }
  if (action === "unlabeled" && label === FORMA_PREVIEW_LABEL) {
    return "destroy";
  }
  if (closed && labels.has(FORMA_PREVIEW_LABEL)) return "destroy";
  if (action === "labeled" && label === FORMA_PREVIEW_LABEL) return "update";
  if (
    labels.has(FORMA_PREVIEW_LABEL) &&
    (action === "opened" || action === "synchronize" || action === "reopened")
  ) {
    return "update";
  }
  return "skip";
}
