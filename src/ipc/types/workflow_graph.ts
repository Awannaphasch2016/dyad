import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const WorkflowStatusSchema = z.enum([
  "idle",
  "pending",
  "ready",
  "running",
  "waiting",
  "completed",
  "failed",
  "skipped",
  "canceled",
]);

export const FormulaNodeSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().max(400),
  instructions: z.string().max(20_000),
  stepType: z.string().trim().min(1).max(64),
  runTarget: z.string().max(256).nullable(),
  hitlRole: z.string().max(64).nullable(),
  metadata: z.record(z.string(), z.string()),
  position: z.object({ x: z.number(), y: z.number() }),
  status: WorkflowStatusSchema,
  beadId: z.string().nullable(),
});

export const FormulaEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});

export const FormulaGraphSchema = z.object({
  formulaName: z.string().trim().min(1).max(128),
  description: z.string().max(4_000),
  persisted: z.boolean(),
  terminal: z.boolean(),
  nodes: z.array(FormulaNodeSchema),
  edges: z.array(FormulaEdgeSchema),
});

const FormulaName = z.string().trim().min(1).max(128);
const AppId = z.number().int().positive();

export const workflowGraphContracts = {
  getGraph: defineContract({
    channel: "workflow-graph:get",
    input: z.object({ appId: AppId, formulaName: FormulaName }),
    output: FormulaGraphSchema,
  }),
  saveGraph: defineContract({
    channel: "workflow-graph:save",
    input: z.object({
      appId: AppId,
      formulaName: FormulaName,
      description: z.string().max(4_000),
      nodes: z.array(FormulaNodeSchema),
      edges: z.array(FormulaEdgeSchema),
    }),
    output: FormulaGraphSchema,
  }),
  saveLayout: defineContract({
    channel: "workflow-graph:save-layout",
    input: z.object({
      appId: AppId,
      formulaName: FormulaName,
      nodes: z.array(
        z.object({
          id: z.string().min(1),
          position: z.object({ x: z.number(), y: z.number() }),
        }),
      ),
    }),
    output: z.object({ ok: z.literal(true) }),
  }),
  closeGate: defineContract({
    channel: "workflow-graph:close-gate",
    input: z.object({
      appId: AppId,
      beadId: z.string().trim().min(1).max(256),
    }),
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

export const workflowGraphClient = createClient(workflowGraphContracts);
