import { z } from "zod";

/** Keeps Clerk's own query params. TanStack otherwise strips them. */
export const clerkAuthSearchSchema = z
  .object({
    redirect: z.string().optional(),
  })
  .passthrough();
