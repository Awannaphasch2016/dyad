import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { WorkflowStatus } from "@/lib/workflow/formulaGraph";

export type FormulaNodeData = {
  title: string;
  stepType: string;
  status: WorkflowStatus;
};

export type FormulaFlowNode = Node<FormulaNodeData, "formula">;

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  idle: "Idle",
  pending: "Pending",
  ready: "Ready",
  running: "Running",
  waiting: "Waiting for human",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  canceled: "Canceled",
};

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  idle: "bg-muted-foreground",
  pending: "bg-amber-500",
  ready: "bg-sky-500",
  running: "bg-blue-500",
  waiting: "bg-orange-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-zinc-400",
  canceled: "bg-zinc-400",
};

export function FormulaNode({
  id,
  data,
  selected,
}: NodeProps<FormulaFlowNode>) {
  return (
    <div
      className={`w-52 rounded-md border bg-background px-3 py-2 shadow-sm ${
        selected ? "border-primary" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="text-sm font-medium">{data.title || "Formula step"}</div>
      <div className="mt-1 text-xs text-muted-foreground">{id}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{data.stepType}</span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block size-2 rounded-full ${STATUS_COLOR[data.status]}`}
            data-status={data.status}
          />
          {STATUS_LABEL[data.status]}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
