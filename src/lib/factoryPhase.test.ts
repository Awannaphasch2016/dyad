import { describe, expect, it } from "vitest";
import {
  continuePrefill,
  factoryPhaseChats,
  hasFactoryPhases,
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

  it("prefills the next phase without sending it", () => {
    expect(continuePrefill("implementation")).toMatch(/Discovery/);
    expect(continuePrefill("delivery")).toMatch(/delivery/i);
    expect(continuePrefill("discovery")).toBeUndefined();
  });
});
