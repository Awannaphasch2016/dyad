import { describe, expect, it } from "vitest";
import { statusForNode } from "./runOverlay";

const gate = { id: "approve", stepType: "gate" };

describe("runOverlay", () => {
  it("maps dashboard statuses onto a formula node", () => {
    expect(
      statusForNode(
        { id: "draft", stepType: "task" },
        {
          terminal: false,
          openHitlStepIds: [],
          nodes: [
            { semanticNodeId: "draft", status: "running", currentBeadId: "b1" },
          ],
        },
      ),
    ).toBe("running");
    expect(
      statusForNode(
        { id: "ship", stepType: "task" },
        {
          terminal: false,
          openHitlStepIds: [],
          nodes: [
            { semanticNodeId: "ship", status: "blocked", currentBeadId: "b2" },
          ],
        },
      ),
    ).toBe("pending");
    expect(
      statusForNode(
        { id: "ship", stepType: "task" },
        {
          terminal: true,
          openHitlStepIds: [],
          nodes: [
            { semanticNodeId: "ship", status: "failed", currentBeadId: "b2" },
          ],
        },
      ),
    ).toBe("failed");
  });

  it("shows a gate with an open question as waiting", () => {
    expect(
      statusForNode(gate, {
        terminal: false,
        openHitlStepIds: ["approve"],
        nodes: [
          { semanticNodeId: "approve", status: "ready", currentBeadId: "gate" },
        ],
      }),
    ).toBe("waiting");
  });

  it("is idle before a run exists", () => {
    expect(statusForNode(gate, null)).toBe("idle");
  });
});
