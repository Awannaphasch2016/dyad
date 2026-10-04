import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FormulaNode, type FormulaFlowNode } from "./FormulaNode";

const nodeTypes = { formula: FormulaNode };

export function WorkflowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeDragStop,
  onSelect,
}: {
  nodes: FormulaFlowNode[];
  edges: Edge[];
  onNodesChange: OnNodesChange<FormulaFlowNode>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  onNodeDragStop: (node: Node) => void;
  onSelect: (id: string | null) => void;
}) {
  const types = useMemo(() => nodeTypes, []);
  return (
    <div className="h-full min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={types}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => onNodeDragStop(node)}
        onSelectionChange={({ nodes: selected }) =>
          onSelect(selected[0]?.id ?? null)
        }
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
