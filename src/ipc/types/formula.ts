import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";
import { FORMULA_PHASES } from "@/lib/formula/phases";

const FormulaPhaseSchema = z.enum(FORMULA_PHASES);

export const formulaContracts = {
  get: defineContract({
    channel: "formula:get",
    input: z.object({ phase: FormulaPhaseSchema }),
    output: z.object({
      phase: FormulaPhaseSchema,
      text: z.string(),
      source: z.enum(["city", "starter"]),
      supervisorConfigured: z.boolean(),
      canUndo: z.boolean(),
    }),
  }),
  validate: defineContract({
    channel: "formula:validate",
    input: z.object({
      phase: FormulaPhaseSchema,
      text: z.string(),
    }),
    output: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
    }),
  }),
  save: defineContract({
    channel: "formula:save",
    input: z.object({
      phase: FormulaPhaseSchema,
      text: z.string(),
    }),
    output: z.object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      text: z.string(),
    }),
  }),
  undo: defineContract({
    channel: "formula:undo",
    input: z.object({ phase: FormulaPhaseSchema }),
    output: z.object({ text: z.string() }),
  }),
} as const;

export const formulaClient = createClient(formulaContracts);
