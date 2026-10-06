export type AppDetailsAvailability = "wait" | "missing" | "ready";

/**
 * An app id that is not in the list yet is still loading.
 * "Missing" is only the result after the list has arrived without that id.
 */
export function appDetailsAvailability(input: {
  appId: number | null;
  appsLoading: boolean;
  loadedAppIds: readonly number[];
}): AppDetailsAvailability {
  if (input.appId == null) return "missing";
  if (input.loadedAppIds.includes(input.appId)) return "ready";
  if (input.appsLoading) return "wait";
  return "missing";
}
