export type AppDetailsView = "ready" | "loading" | "error" | "missing";

/** The address id is unresolved until the app list settles. */
export function resolveAppDetailsView(input: {
  appId: number | null;
  loading: boolean;
  fetchFailed: boolean;
  appIds: readonly number[];
}): AppDetailsView {
  if (input.appId != null && input.appIds.includes(input.appId)) {
    return "ready";
  }
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  return "missing";
}
