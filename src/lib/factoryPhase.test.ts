import { describe, expect, it } from "vitest";
import {
  canContinueFactoryPhase,
  visibleComposerActions,
  showMessageRevisionActions,
  showAssistantModelAttribution,
  showFactoryPhaseComposer,
  continuePrefill,
  extractFactoryPhaseSummary,
  factoryPhaseChatMode,
  factoryPhaseChats,
  factoryPhaseKickoff,
  factoryViewRefetchInterval,
  latestFactoryPhaseSummary,
  appIdsMissingFactoryPhases,
  hasFactoryPhases,
  isFactoryPhaseApproved,
  isFactoryPhaseUnlocked,
  factoryPhaseShade,
  showFactoryPhaseApproval,
  latestUnlockedFactoryPhase,
  lockedFactoryPhaseReason,
  nextFactoryPhase,
  orderedFactoryPhaseChats,
  phaseFromTitle,
  factoryChatIdsToDrop,
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

  it("selects an app that does not have all three phases", () => {
    expect(
      appIdsMissingFactoryPhases(
        [3, 10],
        [
          { appId: 3, title: "Discovery" },
          { appId: 3, title: "Implementation" },
          { appId: 3, title: "Delivery" },
          { appId: 10, title: "Implementation" },
        ],
      ),
    ).toEqual([10]);
  });

  it("selects an app with no chats", () => {
    expect(appIdsMissingFactoryPhases([4], [])).toEqual([4]);
  });

  it("leaves an app alone until it has a phase chat", () => {
    expect(
      factoryChatIdsToDrop([
        { id: 4, title: null, started: false },
        { id: 5, title: "Notes", started: true },
      ]),
    ).toEqual([]);
  });

  it("keeps a started phase and deletes every other chat", () => {
    expect(
      factoryChatIdsToDrop([
        { id: 1, title: "Anime University Club Website", started: true },
        { id: 2, title: "Implementation", started: true },
        { id: 3, title: null, started: false },
        { id: 4, title: "Discovery", started: false },
      ]).sort((left, right) => left - right),
    ).toEqual([1, 3, 4]);
  });

  it("keeps an unstarted phase and still deletes the older chat", () => {
    expect(
      factoryChatIdsToDrop([
        { id: 1, title: "Anime University Club Website", started: true },
        { id: 2, title: "Implementation", started: false },
      ]),
    ).toEqual([1]);
  });

  it("keeps the three phase chats and deletes anything else", () => {
    expect(
      factoryChatIdsToDrop([
        { id: 1, title: "Discovery", started: true },
        { id: 2, title: "Implementation", started: false },
        { id: 3, title: "Delivery", started: false },
        { id: 4, title: "Notes", started: true },
        { id: 5, title: "Discovery", started: false },
      ]).sort((left, right) => left - right),
    ).toEqual([4, 5]);
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

  it("does not treat a started next phase as approval", () => {
    const progress = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation"] as const),
    };
    expect(isFactoryPhaseApproved("discovery", progress)).toBe(false);
    expect(isFactoryPhaseUnlocked("implementation", progress)).toBe(false);
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
        status: "awaiting_review",
      }),
    ).toBe(true);
    expect(
      showFactoryPhaseApproval({
        phase: "discovery",
        progress: runningDiscovery,
        status: "executing",
      }),
    ).toBe(false);

    const implementationStarted = {
      approved: new Set(["discovery"] as const),
      started: new Set(["discovery", "implementation"] as const),
    };
    expect(
      showFactoryPhaseApproval({
        phase: "discovery",
        progress: implementationStarted,
        status: "awaiting_review",
      }),
    ).toBe(false);
    expect(
      showFactoryPhaseApproval({
        phase: "implementation",
        progress: implementationStarted,
        status: "awaiting_review",
      }),
    ).toBe(true);

    const finished = {
      approved: new Set(["discovery", "implementation"] as const),
      started: new Set(["discovery", "implementation", "delivery"] as const),
    };
    expect(
      showFactoryPhaseApproval({
        phase: "implementation",
        progress: finished,
        status: "awaiting_review",
      }),
    ).toBe(false);
    expect(
      showFactoryPhaseApproval({
        phase: "delivery",
        progress: finished,
        status: "executing",
      }),
    ).toBe(false);
    expect(
      showFactoryPhaseApproval({
        phase: "delivery",
        progress: finished,
        status: "awaiting_review",
      }),
    ).toBe(true);
  });

  it("uses a lighter shade while a phase has started and is not finished", () => {
    const discoveryRunning = {
      approved: new Set<never>(),
      started: new Set(["discovery"] as const),
    };
    expect(
      factoryPhaseShade({
        phase: "discovery",
        progress: discoveryRunning,
      }),
    ).toBe("in-progress");
    expect(
      factoryPhaseShade({
        phase: "implementation",
        progress: discoveryRunning,
      }),
    ).toBe("not-started");

    const implementationRunning = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation"] as const),
    };
    expect(
      factoryPhaseShade({
        phase: "discovery",
        progress: implementationRunning,
      }),
    ).toBe("in-progress");
    expect(
      factoryPhaseShade({
        phase: "implementation",
        progress: implementationRunning,
      }),
    ).toBe("in-progress");
    expect(
      factoryPhaseShade({
        phase: "delivery",
        progress: implementationRunning,
      }),
    ).toBe("not-started");

    const finished = {
      approved: new Set<never>(),
      started: new Set(["discovery", "implementation", "delivery"] as const),
    };
    expect(
      factoryPhaseShade({
        phase: "delivery",
        progress: finished,
      }),
    ).toBe("in-progress");
  });

  it("allows approval only while the phase is in review", () => {
    expect(
      canContinueFactoryPhase({ status: "executing", isStreaming: false }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({
        status: "awaiting_review",
        isStreaming: true,
      }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({
        status: "awaiting_review",
        isStreaming: false,
      }),
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

  it("starts Discovery, Implementation, and Delivery when the phase opens", () => {
    expect(factoryPhaseKickoff("discovery", null)).toBe("Start Discovery.");
    expect(factoryPhaseKickoff("implementation", "- **Page name:** X")).toBe(
      "Build the one-page site from this approved Discovery summary:\n\n- **Page name:** X",
    );
    expect(factoryPhaseKickoff("implementation", null)).toMatch(/Discovery/);
    expect(factoryPhaseKickoff("delivery", "- **Page:** Index")).toContain(
      "- **Page:** Index",
    );
  });

  it("refetches only while this window is showing a factory app", () => {
    expect(factoryViewRefetchInterval(true)).toBe(1_000);
    expect(factoryViewRefetchInterval(false)).toBe(false);
  });

  it("hides the composer on a factory phase chat", () => {
    const chats = [
      { title: "Discovery" },
      { title: "Implementation" },
      { title: "Delivery" },
    ];
    expect(showFactoryPhaseComposer(chats, "Discovery")).toBe(false);
    expect(showFactoryPhaseComposer(chats, "Notes")).toBe(true);
    expect(showFactoryPhaseComposer([{ title: "Notes" }], "Notes")).toBe(true);
  });

  it("prefills Implementation with the approved Discovery summary", () => {
    expect(continuePrefill("implementation", "- **Page name:** X")).toBe(
      "Build the one-page site from this approved Discovery summary:\n\n- **Page name:** X",
    );
    expect(continuePrefill("implementation")).toMatch(/Discovery/);
    expect(continuePrefill("delivery")).toBeUndefined();
    expect(continuePrefill("discovery")).toBeUndefined();
  });

  it("hides Keep going on a factory chat", () => {
    const actions = [{ id: "keep-going" }, { id: "refresh" }];
    expect(visibleComposerActions(actions, true)).toEqual([{ id: "refresh" }]);
    expect(visibleComposerActions(actions, false)).toEqual(actions);
  });

  it("hides Undo and Retry on every factory phase chat", () => {
    expect(showMessageRevisionActions(true)).toBe(false);
    expect(showMessageRevisionActions(false)).toBe(true);
  });

  it("hides the assistant model badge on factory phase chats", () => {
    expect(showAssistantModelAttribution(true)).toBe(false);
    expect(showAssistantModelAttribution(false)).toBe(true);
  });
});
