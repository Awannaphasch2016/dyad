import { desc, eq } from "drizzle-orm";
import type { FormulaPhase } from "@/lib/formula/phases";
import type { ControlPlaneDb } from "./db";
import { controlFormulaRevisions } from "./schema";

export type FormulaRevision = {
  id: string;
  phase: FormulaPhase;
  body: string;
  createdAt: Date;
};

export async function appendFormulaRevision(
  db: ControlPlaneDb,
  revision: { id: string; phase: FormulaPhase; body: string },
): Promise<void> {
  await db.insert(controlFormulaRevisions).values(revision);
}

export async function listRecentFormulaRevisions(
  db: ControlPlaneDb,
  phase: FormulaPhase,
  limit: number,
): Promise<FormulaRevision[]> {
  const rows = await db
    .select()
    .from(controlFormulaRevisions)
    .where(eq(controlFormulaRevisions.phase, phase))
    .orderBy(
      desc(controlFormulaRevisions.createdAt),
      desc(controlFormulaRevisions.id),
    )
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    phase: row.phase as FormulaPhase,
    body: row.body,
    createdAt: row.createdAt,
  }));
}
