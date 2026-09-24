import { describe, expect, it } from "vitest";
import { extractFactoryPhaseSummary } from "@/lib/factoryPhase";
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
    expect(prompt).toContain("planning_questionnaire");
    expect(prompt).toContain("Do not write, edit, or plan code");
    expect(prompt).toContain(
      "Do not ask about frameworks, templates, or stacks",
    );
    expect(prompt).toContain("## Discovery summary");
  });

  it("keeps Delivery read-only and Implementation building", () => {
    expect(factoryPhaseSystemPrompt("delivery")).toContain(
      "Do not edit code in this phase",
    );
    expect(factoryPhaseSystemPrompt("implementation")).toContain(
      "Build exactly that one-page website",
    );
  });

  it("asks for a summary shape the approval parser accepts", () => {
    for (const phase of ["discovery", "implementation", "delivery"] as const) {
      const prompt = factoryPhaseSystemPrompt(phase);
      const template = prompt.slice(prompt.indexOf("## "));
      const block = template.split("\n\n")[0];
      expect(extractFactoryPhaseSummary(block, phase)).not.toBeNull();
    }
  });

  it("appends the phase brief after the base prompt", () => {
    const combined = appendFactoryPhaseSystemPrompt("base", "discovery");
    expect(combined.startsWith("base\n\n# Website factory phase")).toBe(true);
  });
});
