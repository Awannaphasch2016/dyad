import { describe, expect, it } from "vitest";
import { DyadError } from "@/errors/dyad_error";
import { REVIEW_PIPELINE_NAME } from "@/lib/workflow/formulaGraph";
import { getWorkflowGraph } from "./workflow_graph_service";

function databaseReturning(app: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => app,
        }),
      }),
    }),
  };
}

describe("getWorkflowGraph", () => {
  it("returns the review pipeline when the app has no Gas City project", async () => {
    const stored = await getWorkflowGraph(
      7,
      REVIEW_PIPELINE_NAME,
      databaseReturning({
        path: "/tmp/unlinked-app",
        gasCityProjectId: null,
      }) as never,
    );
    expect(stored.linked).toBe(false);
    expect(stored.graph.nodes.map((node) => node.id)).toEqual([
      "draft",
      "revise",
      "approve",
      "ship",
    ]);
  });

  it("still reports a missing app", async () => {
    await expect(
      getWorkflowGraph(
        7,
        REVIEW_PIPELINE_NAME,
        databaseReturning(undefined) as never,
      ),
    ).rejects.toBeInstanceOf(DyadError);
  });
});
