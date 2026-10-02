import type { FormulaNodeRecord, WorkflowStatus } from "./formulaGraph";

export type RunNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "active"
  | "done"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped"
  | "canceled";

export type RunNodeSnapshot = {
  semanticNodeId: string;
  status: RunNodeStatus;
  currentBeadId: string;
};

export type RunSnapshot = {
  terminal: boolean;
  nodes: RunNodeSnapshot[];
  openHitlStepIds: string[];
};

export function statusForNode(
  node: Pick<FormulaNodeRecord, "id" | "stepType">,
  run: RunSnapshot | null,
): WorkflowStatus {
  if (!run) return "idle";
  const match = run.nodes.find((item) => item.semanticNodeId === node.id);
  if (!match) return "idle";
  if (
    node.stepType === "gate" &&
    run.openHitlStepIds.includes(node.id) &&
    (match.status === "ready" ||
      match.status === "running" ||
      match.status === "active")
  ) {
    return "waiting";
  }
  switch (match.status) {
    case "pending":
    case "blocked":
      return "pending";
    case "ready":
      return "ready";
    case "running":
    case "active":
      return "running";
    case "done":
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "canceled":
      return "canceled";
    default:
      return "idle";
  }
}

export function beadIdForNode(
  nodeId: string,
  run: RunSnapshot | null,
): string | null {
  return (
    run?.nodes.find((item) => item.semanticNodeId === nodeId)?.currentBeadId ??
    null
  );
}
