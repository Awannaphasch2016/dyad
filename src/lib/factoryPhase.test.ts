import { describe, expect, it } from "vitest";
import {
  canContinueFactoryPhase,
  continuePrefill,
  extractFactoryPhaseSummary,
  factoryPhaseChatMode,
  factoryPhaseChats,
  factoryPhaseKickoff,
  latestFactoryPhaseSummary,
  hasFactoryPhases,
  isFactoryPhaseApproved,
  isFactoryPhaseUnlocked,
  showFactoryPhaseApproval,
  latestUnlockedFactoryPhase,
  lockedFactoryPhaseReason,
  nextFactoryPhase,
  orderedFactoryPhaseChats,
  phaseFromTitle,
  previewOpenForPhase,
} from "./factoryPhase";

describe("factoryPhase", () => {
  it("recognizes the three phase chats by title", () => {
    expect(phaseFromTitle("Discovery")).toBe("discovery");
    expect(phaseFromTitle("Implementation")).toBe("implementation");
    expect(phaseFromTitle("Delivery")).toBe("delivery");
    expect(phaseFromTitle("Tiny Garden")).toBeNull();
    expect(phaseFromTitle(null)).toBeNull();
  });

  it("keeps Discovery and Delivery read-only", () => {
    expect(factoryPhaseChatMode("discovery")).toBe("ask");
    expect(factoryPhaseChatMode("implementation")).toBe("build");
    expect(factoryPhaseChatMode("delivery")).toBe("ask");
  });

  it("opens the preview only for implementation", () => {
    expect(previewOpenForPhase("discovery")).toBe(false);
    expect(previewOpenForPhase("implementation")).toBe(true);
    expect(previewOpenForPhase("delivery")).toBe(false);
  });

  it("moves forward only when the person continues", () => {
    expect(nextFactoryPhase("discovery")).toBe("implementation");
    expect(nextFactoryPhase("implementation")).toBe("delivery");
    expect(nextFactoryPhase("delivery")).toBeNull();
  });

  it("finds one chat per phase and ignores other chats", () => {
    const chats = [
      { id: 1, title: "Discovery" },
      { id: 2, title: "Notes" },
      { id: 3, title: "Implementation" },
      { id: 4, title: "Delivery" },
      { id: 5, title: "Discovery" },
    ];
    expect(hasFactoryPhases(chats)).toBe(true);
    expect(factoryPhaseChats(chats).discovery?.id).toBe(1);
    expect(factoryPhaseChats(chats).implementation?.id).toBe(3);
  });

  it("lists only the phase chats, in phase order", () => {
    const chats = [
      { id: 12, title: null },
      { id: 8, title: "Delivery" },
      { id: 7, title: "Implementation" },
      { id: 6, title: "Discovery" },
    ];
    expect(orderedFactoryPhaseChats(chats).map((chat) => chat.id)).toEqual([
      6, 7, 8,
    ]);
  });

  it("keeps later phases locked until the previous phase is approved", () => {
    const empty = { approved: new Set<never>(), started: new Set<never>() };
    expect(isFactoryPhaseUnlocked("discovery", empty)).toBe(true);
    expect(isFactoryPhaseUnlocked("implementation", empty)).toBe(false);
    expect(isFactoryPhaseUnlocked("delivery", empty)).toBe(false);
    expect(latestUnlockedFactoryPhase(empty)).toBe("discovery");

    const discoveryApproved = {
      approved: new Set(["discovery"] as const),
      started: new Set(["discovery"] as const),
    };
    expect(isFactoryPhaseUnlocked("implementation", discoveryApproved)).toBe(
      true,
    );
    expect(isFactoryPhaseUnlocked("delivery", discoveryApproved)).toBe(false);
    expect(latestUnlockedFactoryPhase(discoveryApproved)).toBe(
      "implementation",
    );
  });

  it("treats a started next phase as approval of the previous one", () => {
    const progress = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation"] as const),
    };
    expect(isFactoryPhaseApproved("discovery", progress)).toBe(true);
    expect(isFactoryPhaseUnlocked("implementation", progress)).toBe(true);
    expect(isFactoryPhaseUnlocked("delivery", progress)).toBe(false);
  });

  it("does not unlock delivery when implementation is approved but discovery is not", () => {
    const progress = {
      approved: new Set(["implementation"] as const),
      started: new Set<never>(),
    };
    expect(isFactoryPhaseUnlocked("delivery", progress)).toBe(false);
  });

  it("hides approval once the factory has moved past that phase", () => {
    const runningDiscovery = {
      approved: new Set<never>(),
      started: new Set(["discovery"] as const),
    };
    expect(
      showFactoryPhaseApproval({
        phase: "discovery",
        progress: runningDiscovery,
        hasPhaseSummary: true,
      }),
    ).toBe(true);

    const implementationStarted = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation"] as const),
    };
    expect(
      showFactoryPhaseApproval({
        phase: "discovery",
        progress: implementationStarted,
        hasPhaseSummary: true,
      }),
    ).toBe(false);
    expect(
      showFactoryPhaseApproval({
        phase: "implementation",
        progress: implementationStarted,
        hasPhaseSummary: false,
      }),
    ).toBe(true);

    const finished = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation", "delivery"] as const),
    };
    expect(
      showFactoryPhaseApproval({
        phase: "implementation",
        progress: finished,
        hasPhaseSummary: true,
      }),
    ).toBe(false);
    expect(
      showFactoryPhaseApproval({
        phase: "delivery",
        progress: finished,
        hasPhaseSummary: false,
      }),
    ).toBe(true);
    expect(
      showFactoryPhaseApproval({
        phase: "delivery",
        progress: finished,
        hasPhaseSummary: true,
      }),
    ).toBe(false);
  });

  it("allows approval only after a finished phase summary", () => {
    expect(
      canContinueFactoryPhase({ hasPhaseSummary: false, isStreaming: false }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({ hasPhaseSummary: true, isStreaming: true }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({ hasPhaseSummary: true, isStreaming: false }),
    ).toBe(true);
    expect(lockedFactoryPhaseReason("delivery")).toBe(
      "Approve Implementation first",
    );
  });

  it("extracts the bullet list under the phase summary heading", () => {
    const content = `<think>I have all three answers.</think>
Here is what I understood. Approve to continue, or tell me what to change.

## Discovery summary
- **Page name:** Tiny Bakery
- **One sentence:** A neighborhood bakery's opening hours and menu.
- **Page contents:** Hero, menu of 3 breads, hours, contact.`;
    expect(extractFactoryPhaseSummary(content, "discovery")).toBe(
      [
        "- **Page name:** Tiny Bakery",
        "- **One sentence:** A neighborhood bakery's opening hours and menu.",
        "- **Page contents:** Hero, menu of 3 breads, hours, contact.",
      ].join("\n"),
    );
    expect(extractFactoryPhaseSummary(content, "implementation")).toBeNull();
  });

  it("ignores summaries that only appear inside thinking or have no bullets", () => {
    expect(
      extractFactoryPhaseSummary(
        "<think>## Discovery summary\n- **Page name:** X</think>What is the page name?",
        "discovery",
      ),
    ).toBeNull();
    expect(
      extractFactoryPhaseSummary(
        "## Discovery summary\n\nComing soon.",
        "discovery",
      ),
    ).toBeNull();
    expect(
      extractFactoryPhaseSummary(
        "### **Discovery Summary:**\n* **Page name:** X\r\n* **One sentence:** Y",
        "discovery",
      ),
    ).toBe("* **Page name:** X\n* **One sentence:** Y");
  });

  it("uses only the latest assistant reply for approval", () => {
    const summary = "## Discovery summary\n- **Page name:** X";
    expect(
      latestFactoryPhaseSummary(
        [
          { role: "assistant", content: summary },
          { role: "user", content: "Change the name" },
          { role: "assistant", content: "What should the new name be?" },
        ],
        "discovery",
      ),
    ).toBeNull();
    expect(
      latestFactoryPhaseSummary(
        [
          { role: "user", content: "Start Discovery." },
          { role: "assistant", content: summary },
        ],
        "discovery",
      ),
    ).toBe("- **Page name:** X");
  });

  it("starts Discovery and Delivery automatically but not Implementation", () => {
    expect(factoryPhaseKickoff("discovery", null)).toBe("Start Discovery.");
    expect(factoryPhaseKickoff("implementation", "- a")).toBeNull();
    expect(factoryPhaseKickoff("delivery", "- **Page:** Index")).toContain(
      "- **Page:** Index",
    );
  });

  it("prefills Implementation with the approved Discovery summary", () => {
    expect(continuePrefill("implementation", "- **Page name:** X")).toBe(
      "Build the one-page site from this approved Discovery summary:\n\n- **Page name:** X",
    );
    expect(continuePrefill("implementation")).toMatch(/Discovery/);
    expect(continuePrefill("delivery")).toBeUndefined();
    expect(continuePrefill("discovery")).toBeUndefined();
  });
});
