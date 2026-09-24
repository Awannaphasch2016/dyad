import { describe, expect, it } from "vitest";
import {
  canContinueFactoryPhase,
  continuePrefill,
  factoryPhaseChats,
  hasFactoryPhases,
  isFactoryPhaseApproved,
  isFactoryPhaseUnlocked,
  latestUnlockedFactoryPhase,
  lockedFactoryPhaseReason,
  nextFactoryPhase,
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

  it("allows Continue only after a finished assistant reply", () => {
    expect(
      canContinueFactoryPhase({ hasAssistantReply: false, isStreaming: false }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({ hasAssistantReply: true, isStreaming: true }),
    ).toBe(false);
    expect(
      canContinueFactoryPhase({ hasAssistantReply: true, isStreaming: false }),
    ).toBe(true);
    expect(lockedFactoryPhaseReason("delivery")).toBe(
      "Approve Implementation first",
    );
  });

  it("prefills the next phase without sending it", () => {
    expect(continuePrefill("implementation")).toMatch(/Discovery/);
    expect(continuePrefill("delivery")).toMatch(/delivery/i);
    expect(continuePrefill("discovery")).toBeUndefined();
  });
});
