import {
  appendFormulaRevision,
  listRecentFormulaRevisions,
} from "@/control_plane/formula_revisions";
import type { ControlPlaneDb } from "@/control_plane/db";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  FormulaRequestError,
  loadFormulaSource,
  upsertFormulaText,
  validateFormulaText,
  type FormulaFetch,
  type FormulaSupervisor,
} from "./gascity_formula_client";
import { starterFormula, type FormulaPhase } from "./phases";

export type FormulaSessionDeps = {
  supervisor: FormulaSupervisor | null;
  db: ControlPlaneDb | null;
  fetch: FormulaFetch;
  createId?: () => string;
};

export type FormulaPageState = {
  phase: FormulaPhase;
  text: string;
  source: "city" | "starter";
  supervisorConfigured: boolean;
  canUndo: boolean;
};

export async function loadFormulaPage(
  deps: FormulaSessionDeps,
  phase: FormulaPhase,
): Promise<FormulaPageState> {
  const canUndo = await hasUndo(deps.db, phase);
  if (!deps.supervisor) {
    return {
      phase,
      text: starterFormula(phase),
      source: "starter",
      supervisorConfigured: false,
      canUndo,
    };
  }
  try {
    const source = await loadFormulaSource(deps.supervisor, phase, deps.fetch);
    if (source === null) {
      return {
        phase,
        text: starterFormula(phase),
        source: "starter",
        supervisorConfigured: true,
        canUndo,
      };
    }
    return {
      phase,
      text: source,
      source: "city",
      supervisorConfigured: true,
      canUndo,
    };
  } catch (error) {
    throw asDyadError(error);
  }
}

export async function validateFormulaPage(
  deps: FormulaSessionDeps,
  phase: FormulaPhase,
  text: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const supervisor = requireSupervisor(deps.supervisor);
  try {
    return await validateFormulaText(supervisor, phase, text, deps.fetch);
  } catch (error) {
    throw asDyadError(error);
  }
}

export async function saveFormulaPage(
  deps: FormulaSessionDeps,
  phase: FormulaPhase,
  text: string,
): Promise<{ valid: boolean; errors: string[]; text: string }> {
  const supervisor = requireSupervisor(deps.supervisor);
  const db = requireHistory(deps.db);
  let checked: { valid: boolean; errors: string[] };
  try {
    checked = await validateFormulaText(supervisor, phase, text, deps.fetch);
  } catch (error) {
    throw asDyadError(error);
  }
  if (!checked.valid) {
    return { valid: false, errors: checked.errors, text };
  }
  try {
    await upsertFormulaText(supervisor, phase, text, deps.fetch);
  } catch (error) {
    throw asDyadError(error);
  }
  await appendFormulaRevision(db, {
    id: (deps.createId ?? crypto.randomUUID)(),
    phase,
    body: text,
  });
  return { valid: true, errors: [], text };
}

export async function undoFormulaPage(
  deps: FormulaSessionDeps,
  phase: FormulaPhase,
): Promise<{ text: string }> {
  const supervisor = requireSupervisor(deps.supervisor);
  const db = requireHistory(deps.db);
  const recent = await listRecentFormulaRevisions(db, phase, 2);
  const previous = recent[1];
  if (!previous) {
    throw new DyadError("Nothing to undo.", DyadErrorKind.Precondition);
  }
  try {
    await upsertFormulaText(supervisor, phase, previous.body, deps.fetch);
  } catch (error) {
    throw asDyadError(error);
  }
  await appendFormulaRevision(db, {
    id: (deps.createId ?? crypto.randomUUID)(),
    phase,
    body: previous.body,
  });
  return { text: previous.body };
}

function requireSupervisor(
  supervisor: FormulaSupervisor | null,
): FormulaSupervisor {
  if (!supervisor) {
    throw new DyadError(
      "GasCity supervisor is not configured.",
      DyadErrorKind.Precondition,
    );
  }
  return supervisor;
}

function requireHistory(db: ControlPlaneDb | null): ControlPlaneDb {
  if (!db) {
    throw new DyadError(
      "Formula history database is not configured.",
      DyadErrorKind.Precondition,
    );
  }
  return db;
}

async function hasUndo(
  db: ControlPlaneDb | null,
  phase: FormulaPhase,
): Promise<boolean> {
  if (!db) return false;
  const recent = await listRecentFormulaRevisions(db, phase, 2);
  return recent.length >= 2;
}

function asDyadError(error: unknown): DyadError {
  if (error instanceof DyadError) return error;
  if (error instanceof FormulaRequestError) {
    const kind =
      error.status === 400
        ? DyadErrorKind.Validation
        : error.status === 401 || error.status === 403
          ? DyadErrorKind.Auth
          : error.status === 404
            ? DyadErrorKind.NotFound
            : DyadErrorKind.External;
    return new DyadError(error.message, kind);
  }
  const message =
    error instanceof Error ? error.message : "GasCity request failed";
  return new DyadError(message, DyadErrorKind.External);
}
