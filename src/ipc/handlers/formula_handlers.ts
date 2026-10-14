import { getControlPlaneDb } from "@/control_plane/db";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  loadFormulaPage,
  saveFormulaPage,
  undoFormulaPage,
  validateFormulaPage,
  type FormulaSessionDeps,
} from "@/lib/formula/formula_session";
import {
  FormulaRequestError,
  readSupervisorConfig,
  type FormulaFetch,
} from "@/lib/formula/gascity_formula_client";
import { formulaContracts } from "../types/formula";
import { createTypedHandler } from "./base";

async function sessionDeps(): Promise<FormulaSessionDeps> {
  let supervisor: FormulaSessionDeps["supervisor"];
  try {
    supervisor = readSupervisorConfig(process.env);
  } catch (error) {
    if (error instanceof FormulaRequestError) {
      throw new DyadError(error.message, DyadErrorKind.Validation);
    }
    throw error;
  }
  return {
    supervisor,
    db: await getControlPlaneDb(),
    fetch: globalThis.fetch as FormulaFetch,
  };
}

export function registerFormulaHandlers() {
  createTypedHandler(formulaContracts.get, async (_event, input) => {
    return loadFormulaPage(await sessionDeps(), input.phase);
  });

  createTypedHandler(formulaContracts.validate, async (_event, input) => {
    return validateFormulaPage(await sessionDeps(), input.phase, input.text);
  });

  createTypedHandler(formulaContracts.save, async (_event, input) => {
    return saveFormulaPage(await sessionDeps(), input.phase, input.text);
  });

  createTypedHandler(formulaContracts.undo, async (_event, input) => {
    return undoFormulaPage(await sessionDeps(), input.phase);
  });
}
