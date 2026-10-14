import { describe, expect, it } from "vitest";
import { extractFactoryRequest } from "@/lib/factoryRequest";
import { extractPhaseFinished } from "@/lib/factoryStop";
import {
  appendFactoryPhaseSystemPrompt,
  factoryPhaseSystemPrompt,
} from "./factory_phase_prompt";

describe("factoryPhaseSystemPrompt", () => {
  it("adds nothing for ordinary chats", () => {
    expect(factoryPhaseSystemPrompt(null)).toBe("");
    expect(appendFactoryPhaseSystemPrompt("base", null)).toBe("base");
  });

  it("tells Discovery to ask for the three answers without coding", () => {
    const prompt = factoryPhaseSystemPrompt("discovery");
    expect(prompt).toContain("Start Discovery.");
    expect(prompt).toContain("## Request for project-manager");
    expect(prompt).toContain("Do not write, edit, or plan code");
    expect(prompt).toContain(
      "Do not ask about frameworks, templates, or stacks",
    );
    expect(prompt).not.toContain("Starting template");
    expect(prompt).not.toContain("Discovery screen");
    expect(prompt).toContain("## Phase finished");
    expect(prompt).not.toContain("## Discovery summary");
  });

  it("keeps Delivery read-only and Implementation building", () => {
    expect(factoryPhaseSystemPrompt("delivery")).toContain(
      "Do not edit code in this phase",
    );
    expect(factoryPhaseSystemPrompt("implementation")).toContain(
      "Build exactly that one-page website",
    );
  });

  it("asks for a finish marker with bullets", () => {
    for (const phase of ["discovery", "implementation", "delivery"] as const) {
      const prompt = factoryPhaseSystemPrompt(phase);
      const start = prompt.indexOf("## Phase finished");
      expect(start).toBeGreaterThan(-1);
      const block = prompt.slice(start).split("\n\n")[0] ?? "";
      expect(extractPhaseFinished(block)).not.toBeNull();
    }
  });

  it("tells every phase how to stop and ask a role", () => {
    for (const phase of ["discovery", "implementation", "delivery"] as const) {
      const prompt = factoryPhaseSystemPrompt(phase);
      expect(prompt).toContain("then stop");
      expect(extractFactoryRequest(prompt)).toEqual({
        role: "project-manager",
        body: "<the question>",
      });
    }
  });

  it("appends the phase brief after the base prompt", () => {
    const combined = appendFactoryPhaseSystemPrompt("base", "discovery");
    expect(combined.startsWith("base\n\n# Website factory phase")).toBe(true);
  });
});
