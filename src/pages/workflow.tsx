import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import {
  FormulaInspector,
  type InspectorNode,
} from "@/components/workflow/FormulaInspector";
import type { FormulaFlowNode } from "@/components/workflow/FormulaNode";
import { ipc } from "@/ipc/types";
import { edgeId, REVIEW_PIPELINE_NAME } from "@/lib/workflow/formulaGraph";
import { columnPositions } from "@/lib/workflow/layout";
import { showError, showSuccess } from "@/lib/toast";

type GraphNode = {
  id: string;
  title: string;
  instructions: string;
  stepType: string;
  runTarget: string | null;
  hitlRole: string | null;
  metadata: Record<string, string>;
  position: { x: number; y: number };
  status: FormulaFlowNode["data"]["status"];
  beadId: string | null;
};

export default function WorkflowPage() {
  const { appId } = useSearch({ from: "/workflow" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formulaName, setFormulaName] = useState(REVIEW_PIPELINE_NAME);
  const [nameDraft, setNameDraft] = useState(REVIEW_PIPELINE_NAME);
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);

  const graphQuery = useQuery({
    queryKey: ["workflow-graph", appId, formulaName],
    queryFn: () => ipc.workflowGraph.getGraph({ appId: appId!, formulaName }),
    enabled: appId != null,
  });

  useEffect(() => {
    if (!graphQuery.data) return;
    setDescription(graphQuery.data.description);
    setNodes(graphQuery.data.nodes);
    setEdges(graphQuery.data.edges);
    setTerminal(graphQuery.data.terminal);
  }, [graphQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (next?: { nodes: GraphNode[]; edges: Edge[] }) =>
      ipc.workflowGraph.saveGraph({
        appId: appId!,
        formulaName,
        description,
        nodes: next?.nodes ?? nodes,
        edges: (next?.edges ?? edges).map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        })),
      }),
    onSuccess: (saved) => {
      setNodes(saved.nodes);
      setEdges(saved.edges);
      setTerminal(saved.terminal);
      queryClient.setQueryData(["workflow-graph", appId, formulaName], saved);
      showSuccess("Formula saved");
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Save failed"),
  });

  const layoutMutation = useMutation({
    mutationFn: (next: GraphNode[]) =>
      ipc.workflowGraph.saveLayout({
        appId: appId!,
        formulaName,
        nodes: next.map((node) => ({ id: node.id, position: node.position })),
      }),
  });

  const closeMutation = useMutation({
    mutationFn: (beadId: string) =>
      ipc.workflowGraph.closeGate({ appId: appId!, beadId }),
    onSuccess: () => {
      showSuccess("Gate bead closed");
      void graphQuery.refetch();
    },
    onError: (error) =>
      showError(error instanceof Error ? error.message : "Close failed"),
  });

  const flowNodes = useMemo<FormulaFlowNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        type: "formula",
        position: node.position,
        data: {
          title: node.title,
          stepType: node.stepType,
          status: node.status,
        },
        selected: node.id === selectedId,
      })),
    [nodes, selectedId],
  );

  const onNodesChange: OnNodesChange<FormulaFlowNode> = (changes) => {
    setNodes((current) => {
      const flow = applyNodeChanges(changes, flowNodesFrom(current));
      return current.map((node) => {
        const moved = flow.find((item) => item.id === node.id);
        return moved ? { ...node, position: moved.position } : node;
      });
    });
  };

  const onEdgesChange: OnEdgesChange<Edge> = (changes) => {
    const next = applyEdgeChanges(changes, edges);
    setEdges(next);
    if (changes.some((change) => change.type === "remove")) {
      saveMutation.mutate({ nodes, edges: next });
    }
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    const id = edgeId(connection.source, connection.target);
    if (edges.some((edge) => edge.id === id)) return;
    const next = [
      ...edges,
      { id, source: connection.source, target: connection.target },
    ];
    setEdges(next);
    saveMutation.mutate({ nodes, edges: next });
  };

  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  const commitFormulaName = () => {
    const next = nameDraft.trim();
    if (next && next !== formulaName) setFormulaName(next);
  };

  if (appId == null) {
    return (
      <div className="p-6">
        <p>Open an app, then return to its formula graph.</p>
        <Button className="mt-3" onClick={() => navigate({ to: "/" })}>
          Back to apps
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          onClick={() => navigate({ to: "/chat", search: { appId } })}
        >
          Back
        </Button>
        <Input
          className="max-w-xs"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitFormulaName}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitFormulaName();
          }}
          aria-label="Formula name"
        />
        <Input
          className="max-w-md"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-label="Formula description"
        />
        <Button
          variant="outline"
          onClick={() => {
            const id = nextStepId(nodes);
            const positions = columnPositions(
              [...nodes.map((node) => node.id), id],
              edges.map((edge) => ({
                source: edge.source,
                target: edge.target,
              })),
            );
            setNodes((current) => [
              ...current,
              {
                id,
                title: "New step",
                instructions: "",
                stepType: "task",
                runTarget: null,
                hitlRole: null,
                metadata: {},
                position: positions[id] ?? { x: 0, y: 0 },
                status: "idle",
                beadId: null,
              },
            ]);
            setSelectedId(id);
          }}
        >
          Add formula node
        </Button>
        <Button
          onClick={() => saveMutation.mutate(undefined)}
          disabled={saveMutation.isPending}
        >
          Save
        </Button>
        {terminal && (
          <span className="text-sm text-muted-foreground">Run finished</span>
        )}
        {graphQuery.isError && (
          <span className="text-sm text-destructive">
            {graphQuery.error instanceof Error
              ? graphQuery.error.message
              : "Could not load the formula"}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <WorkflowCanvas
          nodes={flowNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={(node: Node) => {
            const next = nodes.map((item) =>
              item.id === node.id ? { ...item, position: node.position } : item,
            );
            setNodes(next);
            layoutMutation.mutate(next);
          }}
          onSelect={setSelectedId}
        />
        <FormulaInspector
          node={selected}
          onChange={(next: InspectorNode) =>
            setNodes((current) =>
              current.map((item) =>
                item.id === next.id ? { ...item, ...next } : item,
              ),
            )
          }
          onDelete={(id) => {
            const nextNodes = nodes.filter((node) => node.id !== id);
            const nextEdges = edges.filter(
              (edge) => edge.source !== id && edge.target !== id,
            );
            setNodes(nextNodes);
            setEdges(nextEdges);
            setSelectedId(null);
            saveMutation.mutate({ nodes: nextNodes, edges: nextEdges });
          }}
          onCloseGate={(beadId) => closeMutation.mutate(beadId)}
          closePending={closeMutation.isPending}
        />
      </div>
    </div>
  );
}

function flowNodesFrom(nodes: GraphNode[]): FormulaFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "formula" as const,
    position: node.position,
    data: {
      title: node.title,
      stepType: node.stepType,
      status: node.status,
    },
  }));
}

function nextStepId(nodes: GraphNode[]): string {
  let index = nodes.length + 1;
  const ids = new Set(nodes.map((node) => node.id));
  while (ids.has(`step-${index}`)) index += 1;
  return `step-${index}`;
}
