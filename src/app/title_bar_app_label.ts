/** "No app selected" is for a settled list. A loading list with an address id stays quiet. */
export function titleBarAppLabel(input: {
  selectedAppId: number | null;
  loading: boolean;
  apps: readonly { id: number; name: string }[];
}): { text: string; quiet: boolean } {
  const selected = input.apps.find((app) => app.id === input.selectedAppId);
  if (selected) return { text: selected.name, quiet: false };
  if (input.loading && input.selectedAppId != null) {
    return { text: "", quiet: true };
  }
  return { text: "No app selected", quiet: false };
}
