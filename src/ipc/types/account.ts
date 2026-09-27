import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const AccountRefSchema = z.object({
  type: z.enum(["user", "org"]),
  id: z.string(),
  name: z.string(),
});

export const AccountContextSchema = z.object({
  sharing: z.boolean(),
  account: AccountRefSchema.nullable(),
});

export const MoveAppParamsSchema = z.object({
  appId: z.number(),
  ownerType: z.enum(["user", "org"]),
  ownerId: z.string(),
});

export const SetAccountConnectionParamsSchema = z.object({
  provider: z.enum(["github", "supabase"]),
  token: z.string(),
  githubOrg: z.string().nullable().optional(),
});

export const AccountConnectionStatusSchema = z.object({
  github: z.boolean(),
  supabase: z.boolean(),
});

export const accountContracts = {
  getContext: defineContract({
    channel: "account:get-context",
    input: z.void(),
    output: AccountContextSchema,
  }),
  moveApp: defineContract({
    channel: "account:move-app",
    input: MoveAppParamsSchema,
    output: z.void(),
  }),
  copyApp: defineContract({
    channel: "account:copy-app",
    input: MoveAppParamsSchema,
    output: z.object({ appId: z.number() }),
  }),
  setConnection: defineContract({
    channel: "account:set-connection",
    input: SetAccountConnectionParamsSchema,
    output: z.void(),
  }),
  connectionStatus: defineContract({
    channel: "account:connection-status",
    input: z.void(),
    output: AccountConnectionStatusSchema,
  }),
} as const;

export const accountClient = createClient(accountContracts);
