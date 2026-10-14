import { describe, expect, it } from "vitest";
import {
  FORMULA_PHASES,
  formulaPhaseLabel,
  isFormulaPhase,
  starterFormula,
} from "./phases";

describe("formula phases", () => {
  it("maps each phase to its own file name", () => {
    expect(FORMULA_PHASES).toEqual(["discovery", "implementation", "delivery"]);
    expect(formulaPhaseLabel("implementation")).toBe("Implementation");
    expect(isFormulaPhase("delivery")).toBe(true);
    expect(isFormulaPhase("phase")).toBe(false);
  });

  it("gives each starter its own formula name and compiler requirement", () => {
    for (const phase of FORMULA_PHASES) {
      const text = starterFormula(phase);
      expect(text).toContain(`formula = "${phase}"`);
      expect(text).toContain('formula_compiler = ">=2.0.0"');
      expect(text).not.toContain("phase =");
    }
    expect(starterFormula("discovery")).not.toBe(
      starterFormula("implementation"),
    );
  });
});
