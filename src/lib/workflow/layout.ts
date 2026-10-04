import type { FormulaEdgeRecord } from "./formulaGraph";

export type Point = { x: number; y: number };

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 140;

/** Place nodes in columns from the longest chain of predecessors. */
export function columnPositions(
  nodeIds: readonly string[],
  edges: readonly Pick<FormulaEdgeRecord, "source" | "target">[],
): Record<string, Point> {
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const edge of edges) incoming.get(edge.target)?.push(edge.source);

  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const predecessors = incoming.get(id) ?? [];
    const value =
      predecessors.length === 0
        ? 0
        : 1 + Math.max(...predecessors.map(depthOf));
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };

  const rows = new Map<number, number>();
  const positions: Record<string, Point> = {};
  for (const id of nodeIds) {
    const column = depthOf(id);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions[id] = { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT };
  }
  return positions;
}

/** Saved coordinates win. New nodes keep the computed column. */
export function mergePositions(
  computed: Record<string, Point>,
  saved: Record<string, Point>,
): Record<string, Point> {
  const merged: Record<string, Point> = {};
  for (const [id, point] of Object.entries(computed)) {
    merged[id] = saved[id] ?? point;
  }
  return merged;
}
