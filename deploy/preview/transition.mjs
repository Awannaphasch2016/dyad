// Pure preview lifecycle. No clocks, no network, no secrets.

const states = new Set([
  "absent",
  "provisioning",
  "ready",
  "updating",
  "destroying",
  "failed",
]);

export function transition(state, event) {
  if (!states.has(state)) return { state: "failed", effect: "none" };
  switch (event) {
    case "create":
    case "update":
      if (state === "destroying") return { state, effect: "none" };
      if (state === "absent" || state === "failed") {
        return { state: "provisioning", effect: "up" };
      }
      if (state === "ready") return { state: "updating", effect: "up" };
      return { state, effect: "up" };
    case "ready":
      if (
        state === "provisioning" ||
        state === "updating" ||
        state === "ready"
      ) {
        return { state: "ready", effect: "none" };
      }
      return { state, effect: "none" };
    case "destroy":
      if (state === "absent") return { state: "absent", effect: "none" };
      return { state: "destroying", effect: "down" };
    case "destroyed":
      if (state === "destroying") return { state: "absent", effect: "none" };
      return { state, effect: "none" };
    case "fail":
      return { state: "failed", effect: "none" };
    default:
      return { state, effect: "none" };
  }
}

// Closing the pull request, or removing the preview label, destroys that
// preview. A synchronize event without the label does not destroy. Preview 20
// was created before the label existed, and a push must not delete it.
export function commandForPullRequest(event) {
  const action = event.action || "";
  const labels = new Set(event.labels || []);
  if (event.closed || action === "closed") return "destroy";
  if (action === "unlabeled" && event.label === "preview") return "destroy";
  if (action === "labeled" && event.label === "preview") return "update";
  if (
    labels.has("preview") &&
    (action === "opened" || action === "synchronize" || action === "reopened")
  ) {
    return "update";
  }
  return "skip";
}
