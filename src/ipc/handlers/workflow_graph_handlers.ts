import { db } from "@/db";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { FormulaGraphError } from "@/lib/workflow/formulaGraph";
import { statusForNode, beadIdForNode } from "@/lib/workflow/runOverlay";
import {
  closeWorkflowGate,
  getWorkflowGraph,
  saveWorkflowGraph,
  saveWorkflowLayout,
} from "@/main/workflow_graph_service";
import type { FormulaGraph } from "@/lib/workflow/formulaGraph";
import type { Point } from "@/lib/workflow/layout";
import type { StoredFormulaGraph } from "@/lib/workflow/formulaFiles";
import { createTypedHandler } from "./base";
import { workflowGraphContracts } from "../types/workflow_graph";

function toResponse(stored: StoredFormulaGraph) {
  return {
    formulaName: stored.graph.formulaName,
    description: stored.graph.description,
    persisted: stored.persisted,
    terminal: stored.run?.terminal ?? false,
    nodes: stored.graph.nodes.map((node) => ({
      ...node,
      position: stored.positions[node.id] ?? { x: 0, y: 0 },
      status: statusForNode(node, stored.run),
      beadId: beadIdForNode(node.id, stored.run),
    })),
    edges: stored.graph.edges,
  };
}

function graphFromInput(input: {
  formulaName: string;
  description: string;
  nodes: {
    id: string;
    title: string;
    instructions: string;
    stepType: string;
    runTarget: string | null;
    hitlRole: string | null;
    metadata: Record<string, string>;
    position: Point;
    status: string;
    beadId: string | null;
  }[];
  edges: { id: string; source: string; target: string }[];
}): { graph: FormulaGraph; positions: Record<string, Point> } {
  return {
    graph: {
      formulaName: input.formulaName,
      description: input.description,
      nodes: input.nodes.map(
        ({ position: _position, status: _status, beadId: _beadId, ...node }) =>
          node,
      ),
      edges: input.edges,
    },
    positions: Object.fromEntries(
      input.nodes.map((node) => [node.id, node.position]),
    ),
  };
}

function asDyadError(error: unknown): never {
  if (error instanceof DyadError) throw error;
  if (error instanceof FormulaGraphError) {
    throw new DyadError(error.message, DyadErrorKind.Validation);
  }
  throw error;
}

export function registerWorkflowGraphHandlers() {
  createTypedHandler(workflowGraphContracts.getGraph, async (_, input) => {
    try {
      return toResponse(
        await getWorkflowGraph(input.appId, input.formulaName, db),
      );
    } catch (error) {
      asDyadError(error);
    }
  });

  createTypedHandler(workflowGraphContracts.saveGraph, async (_, input) => {
    try {
      const { graph, positions } = graphFromInput(input);
      return toResponse(
        await saveWorkflowGraph(input.appId, graph, positions, db),
      );
    } catch (error) {
      asDyadError(error);
    }
  });

  createTypedHandler(workflowGraphContracts.saveLayout, async (_, input) => {
    try {
      await saveWorkflowLayout(
        input.appId,
        input.formulaName,
        Object.fromEntries(input.nodes.map((node) => [node.id, node.position])),
        db,
      );
      return { ok: true as const };
    } catch (error) {
      asDyadError(error);
    }
  });

  createTypedHandler(workflowGraphContracts.closeGate, async (_, input) => {
    try {
      await closeWorkflowGate(input.appId, input.beadId, db);
      return { ok: true as const };
    } catch (error) {
      asDyadError(error);
    }
  });
}
