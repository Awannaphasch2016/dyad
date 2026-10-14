import { describe, expect, it } from "vitest";
import {
  closedFormulaPhases,
  formulaStep,
  FACTORY_FORMULA,
} from "./factoryFormula";

describe("factory formula cursor", () => {
  it("names the formula GasCity compiles", () => {
    expect(FACTORY_FORMULA).toBe("speckit-phased");
  });

  it("keeps Implementation locked until the Discovery gate is behind the open bead", () => {
    expect(formulaStep("accept-discovery")?.phase).toBe("discovery");
    expect(closedFormulaPhases("accept-discovery")).toEqual([]);
    expect(closedFormulaPhases("implement")).toEqual(["discovery"]);
    expect(closedFormulaPhases("accept-delivery")).toEqual([
      "discovery",
      "implementation",
    ]);
    expect(closedFormulaPhases("publish")).toEqual([
      "discovery",
      "implementation",
    ]);
    expect(closedFormulaPhases("publish", "completed")).toEqual([
      "discovery",
      "implementation",
      "delivery",
    ]);
  });

  it("rejects a step that is not on the formula", () => {
    expect(formulaStep("counter")).toBeNull();
  });
});
