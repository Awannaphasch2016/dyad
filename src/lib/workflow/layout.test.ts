import { describe, expect, it } from "vitest";
import { columnPositions, mergePositions } from "./layout";

describe("layout", () => {
  it("places a chain in columns", () => {
    const positions = columnPositions(
      ["draft", "revise", "approve"],
      [
        { source: "draft", target: "revise" },
        { source: "revise", target: "approve" },
      ],
    );
    expect(positions.draft).toEqual({ x: 0, y: 0 });
    expect(positions.revise?.x).toBeGreaterThan(positions.draft?.x ?? 0);
    expect(positions.approve?.x).toBeGreaterThan(positions.revise?.x ?? 0);
  });

  it("keeps a saved position", () => {
    const computed = columnPositions(["draft"], []);
    expect(mergePositions(computed, { draft: { x: 12, y: 34 } }).draft).toEqual(
      { x: 12, y: 34 },
    );
  });
});
