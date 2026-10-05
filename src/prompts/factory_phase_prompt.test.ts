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
    expect(prompt).not.toContain("Starting template");
    expect(prompt).not.toContain("Discovery screen");
    expect(prompt).toContain("## Discovery summary");
  });

  it("keeps Delivery read-only", () => {
    const prompt = factoryPhaseSystemPrompt("delivery");
    expect(prompt).toContain("Do not edit code in this phase");
    expect(prompt).not.toContain("write_app_blueprint");
  });

  it("writes the blueprint before the page, then builds once the gate is gone", () => {
    const prompt = factoryPhaseSystemPrompt("implementation");
    expect(prompt).toContain("write_app_blueprint");
    expect(prompt).toContain("Do not call `planning_questionnaire`");
    expect(prompt).toContain("Required App Blueprint Gate");
    expect(prompt).toContain("Do not call `write_file`");
    expect(prompt).toContain("`search_replace`");
    expect(prompt).toContain("Build exactly that one-page website");
    expect(prompt).toContain("template_id");
    expect(factoryPhaseSystemPrompt("discovery")).not.toContain(
      "write_app_blueprint",
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
