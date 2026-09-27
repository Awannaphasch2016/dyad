import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const FactoryPhaseSchema = z.enum([
  "discovery",
  "implementation",
  "delivery",
]);

export const FactoryStateSchema = z.object({
  appId: z.number().int().positive(),
  factoryHostManaged: z.boolean(),
  gasCityProjectId: z.string().nullable(),
  approvedPhases: z.array(FactoryPhaseSchema),
});

export const factoryHostContracts = {
  getState: defineContract({
    channel: "factory-host:get-state",
    input: z.object({ appId: z.number().int().positive() }),
    output: FactoryStateSchema,
  }),
  approvePhase: defineContract({
    channel: "factory-host:approve-phase",
    input: z.object({
      appId: z.number().int().positive(),
      phase: FactoryPhaseSchema,
    }),
    output: FactoryStateSchema,
  }),
} as const;

export const factoryHostClient = createClient(factoryHostContracts);
