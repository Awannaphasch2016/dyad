// The canary register script does not wait until the new task is running.
// Promotion refuses to publish until this exact image is the only running task.

export const expectedCanaryImageTag = "canary-84e92b25c10d";
export const previousCanaryImageTag = "canary-bf0965717843";

export function dyadImageTag(task) {
  const container = (task?.containers || []).find(
    (item) => item.name === "dyad",
  );
  const image = container?.image || "";
  const slash = image.lastIndexOf("/");
  const name = slash >= 0 ? image.slice(slash + 1) : image;
  const colon = name.lastIndexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : "";
}

export function imageDecision(
  described,
  expected = expectedCanaryImageTag,
  previous = previousCanaryImageTag,
) {
  const tasks = Array.isArray(described) ? described : (described?.tasks ?? []);
  const running = tasks.filter(
    (task) => task.lastStatus === "RUNNING" && task.desiredStatus === "RUNNING",
  );
  if (running.length === 0) return { ready: false, reason: "none" };
  if (running.length !== 1) return { ready: false, reason: "multiple" };
  const tag = dyadImageTag(running[0]);
  if (tag === expected) return { ready: true, tag };
  if (tag === previous) return { ready: false, reason: "previous" };
  return { ready: false, reason: "unexpected", tag };
}
