import { describe, expect, it } from "vitest";
import {
  exampleReviewPipeline,
  FormulaGraphError,
  parseFormulaToml,
  serializeFormulaToml,
} from "./formulaGraph";

describe("formulaGraph", () => {
  it("round-trips the review pipeline as four formula nodes", () => {
    const graph = exampleReviewPipeline();
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "draft",
      "revise",
      "approve",
      "ship",
    ]);
    expect(graph.nodes.every((node) => node.stepType)).toBe(true);
    expect(graph.nodes[2]?.stepType).toBe("gate");
    expect(graph.nodes[2]?.hitlRole).toBe("project-manager");
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["draft", "revise"],
      ["revise", "approve"],
      ["approve", "ship"],
    ]);
    expect(parseFormulaToml(serializeFormulaToml(graph))).toEqual(graph);
  });

  it("drops a compiler-owned finalize step", () => {
    const graph = parseFormulaToml(`formula = "review-pipeline"
description = "with finalize"

[[steps]]
id = "draft"
title = "Draft"

[[steps]]
id = "workflow-finalize"
title = "Finalize workflow"
needs = ["draft"]
`);
    expect(graph.nodes.map((node) => node.id)).toEqual(["draft"]);
    expect(graph.edges).toEqual([]);
    expect(serializeFormulaToml(graph)).not.toContain("workflow-finalize");
  });

  it("rejects a cycle", () => {
    expect(() =>
      parseFormulaToml(`formula = "loop"
description = ""

[[steps]]
id = "a"
title = "A"
needs = ["b"]

[[steps]]
id = "b"
title = "B"
needs = ["a"]
`),
    ).toThrow(FormulaGraphError);
  });

  it("keeps run target on the step and leaves status out of the formula", () => {
    const graph = exampleReviewPipeline();
    const draft = graph.nodes[0];
    if (!draft) throw new Error("missing draft");
    draft.runTarget = "reviewer";
    const source = serializeFormulaToml(graph);
    expect(source).toContain('"gc.run_target" = "reviewer"');
    expect(source).not.toContain("status");
    expect(parseFormulaToml(source).nodes[0]?.runTarget).toBe("reviewer");
  });

  it("refuses constructs this editor does not write", () => {
    expect(() =>
      parseFormulaToml(`formula = "checked"
description = ""

[[steps]]
id = "a"
title = "A"
check = { mode = "exec" }
`),
    ).toThrow(/Unsupported fields/);
  });
});
