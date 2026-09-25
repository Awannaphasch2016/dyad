import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const KnowledgeItemSchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string(),
  url: z.string(),
  addedBy: z.string(),
  createdAt: z.date(),
});

export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

export const ListKnowledgeItemsParamsSchema = z.object({
  appId: z.number(),
});

export const CreateKnowledgeItemParamsSchema = z.object({
  appId: z.number(),
  title: z.string(),
  url: z.string(),
  addedBy: z.string().optional(),
});

export const DeleteKnowledgeItemParamsSchema = z.object({
  id: z.number(),
  appId: z.number(),
});

export const knowledgeContracts = {
  list: defineContract({
    channel: "knowledge:list",
    input: ListKnowledgeItemsParamsSchema,
    output: z.array(KnowledgeItemSchema),
  }),
  create: defineContract({
    channel: "knowledge:create",
    input: CreateKnowledgeItemParamsSchema,
    output: KnowledgeItemSchema,
  }),
  delete: defineContract({
    channel: "knowledge:delete",
    input: DeleteKnowledgeItemParamsSchema,
    output: z.void(),
  }),
} as const;

export const knowledgeClient = createClient(knowledgeContracts);
