export function runtimeStatusLine(input: {
  status: "open" | "answered";
  runtimeRunId: string | null;
  preview: boolean;
}): string | null {
  if (input.runtimeRunId && input.runtimeRunId !== "refused") {
    return `Run accepted. ${input.runtimeRunId}`;
  }
  if (input.runtimeRunId === "refused") {
    return "The runtime refused the run.";
  }
  if (!input.preview) return null;
  if (input.status === "open") return "Question stored.";
  return "Waiting for the runtime.";
}
