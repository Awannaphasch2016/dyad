import path from "node:path";
import { eq } from "drizzle-orm";
import { db, type db as productionDb } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import {
  closeGateBead,
  compileWithGc,
  readStoredFormula,
  saveStoredFormula,
  saveStoredLayout,
  unlinkedStoredFormula,
  type FormulaCompiler,
  type StoredFormulaGraph,
} from "@/lib/workflow/formulaFiles";
import type { FormulaGraph } from "@/lib/workflow/formulaGraph";
import type { Point } from "@/lib/workflow/layout";

type Database = typeof productionDb;

export function resolveGasCityProjectDir(app: {
  path: string;
  gasCityProjectId: string | null;
}): string {
  if (!app.gasCityProjectId) {
    throw new DyadError(
      "This app is not linked to a Gas City project.",
      DyadErrorKind.Precondition,
    );
  }
  return path.isAbsolute(app.gasCityProjectId)
    ? app.gasCityProjectId
    : path.resolve(app.path, app.gasCityProjectId);
}

function projectDirForApp(database: Database, appId: number): string {
  const app = database.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) throw new DyadError("App not found", DyadErrorKind.NotFound);
  return resolveGasCityProjectDir(app);
}

export async function getWorkflowGraph(
  appId: number,
  formulaName: string,
  database: Database = db,
): Promise<StoredFormulaGraph> {
  try {
    return await readStoredFormula(
      projectDirForApp(database, appId),
      formulaName,
    );
  } catch (error) {
    if (isDyadError(error) && error.kind === DyadErrorKind.Precondition) {
      return unlinkedStoredFormula(formulaName);
    }
    throw error;
  }
}

export async function saveWorkflowGraph(
  appId: number,
  graph: FormulaGraph,
  positions: Record<string, Point>,
  database: Database = db,
  compile: FormulaCompiler = compileWithGc,
): Promise<StoredFormulaGraph> {
  const projectDir = projectDirForApp(database, appId);
  try {
    await saveStoredFormula(projectDir, graph, positions, compile);
  } catch (error) {
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      error instanceof Error ? error.message : "Could not save the formula.",
      DyadErrorKind.Validation,
    );
  }
  return readStoredFormula(projectDir, graph.formulaName);
}

export async function saveWorkflowLayout(
  appId: number,
  formulaName: string,
  positions: Record<string, Point>,
  database: Database = db,
): Promise<void> {
  await saveStoredLayout(
    projectDirForApp(database, appId),
    formulaName,
    positions,
  );
}

export async function closeWorkflowGate(
  appId: number,
  beadId: string,
  database: Database = db,
): Promise<void> {
  try {
    await closeGateBead(projectDirForApp(database, appId), beadId);
  } catch (error) {
    throw new DyadError(
      error instanceof Error ? error.message : "Could not close the gate bead.",
      DyadErrorKind.External,
    );
  }
}
