import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  emptyFormula,
  exampleReviewPipeline,
  parseFormulaToml,
  REVIEW_PIPELINE_NAME,
  serializeFormulaToml,
  type FormulaGraph,
} from "./formulaGraph";
import { columnPositions, mergePositions, type Point } from "./layout";
import { type RunSnapshot } from "./runOverlay";

const execFileAsync = promisify(execFile);

export type StoredFormulaGraph = {
  graph: FormulaGraph;
  positions: Record<string, Point>;
  persisted: boolean;
  run: RunSnapshot | null;
};

export type FormulaCompiler = (
  projectDir: string,
  formulaName: string,
) => Promise<void>;

export function formulaFilePath(
  projectDir: string,
  formulaName: string,
): string {
  return path.join(projectDir, "formulas", `${formulaName}.toml`);
}

export function layoutFilePath(
  projectDir: string,
  formulaName: string,
): string {
  return path.join(projectDir, "formulas", `${formulaName}.layout.json`);
}

export function runFilePath(projectDir: string, formulaName: string): string {
  return path.join(projectDir, "formulas", `${formulaName}.run.json`);
}

export async function readStoredFormula(
  projectDir: string,
  formulaName: string,
): Promise<StoredFormulaGraph> {
  const filePath = formulaFilePath(projectDir, formulaName);
  let graph: FormulaGraph;
  let persisted = true;
  try {
    graph = parseFormulaToml(await readFile(filePath, "utf8"));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    graph =
      formulaName === REVIEW_PIPELINE_NAME
        ? exampleReviewPipeline()
        : emptyFormula(formulaName);
    persisted = false;
  }
  const saved = await readPositions(projectDir, formulaName);
  const positions = mergePositions(
    columnPositions(
      graph.nodes.map((node) => node.id),
      graph.edges,
    ),
    saved,
  );
  return {
    graph,
    positions,
    persisted,
    run: await readRun(projectDir, formulaName),
  };
}

export async function saveStoredFormula(
  projectDir: string,
  graph: FormulaGraph,
  positions: Record<string, Point>,
  compile: FormulaCompiler,
): Promise<void> {
  const filePath = formulaFilePath(projectDir, graph.formulaName);
  await mkdir(path.dirname(filePath), { recursive: true });
  const previous = await readOptional(filePath);
  await writeFile(filePath, serializeFormulaToml(graph), "utf8");
  try {
    await compile(projectDir, graph.formulaName);
  } catch (error) {
    if (previous === null) await rm(filePath, { force: true });
    else await writeFile(filePath, previous, "utf8");
    throw error;
  }
  await writePositions(projectDir, graph.formulaName, positions);
}

export async function saveStoredLayout(
  projectDir: string,
  formulaName: string,
  positions: Record<string, Point>,
): Promise<void> {
  await mkdir(path.join(projectDir, "formulas"), { recursive: true });
  await writePositions(projectDir, formulaName, positions);
}

export async function compileWithGc(
  projectDir: string,
  formulaName: string,
): Promise<void> {
  try {
    await execFileAsync("gc", ["formula", "show", formulaName], {
      cwd: projectDir,
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    const message =
      stderr.trim() ||
      (error instanceof Error ? error.message : "gc formula show failed");
    throw new Error(message);
  }
}

export async function closeGateBead(
  projectDir: string,
  beadId: string,
): Promise<void> {
  try {
    await execFileAsync("gc", ["bd", "close", beadId], { cwd: projectDir });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    const message =
      stderr.trim() ||
      (error instanceof Error ? error.message : "gc bd close failed");
    throw new Error(message);
  }
}

async function readPositions(
  projectDir: string,
  formulaName: string,
): Promise<Record<string, Point>> {
  try {
    const parsed = JSON.parse(
      await readFile(layoutFilePath(projectDir, formulaName), "utf8"),
    ) as { nodes?: { id: string; x: number; y: number }[] };
    const positions: Record<string, Point> = {};
    for (const node of parsed.nodes ?? []) {
      positions[node.id] = { x: node.x, y: node.y };
    }
    return positions;
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw error;
  }
}

async function writePositions(
  projectDir: string,
  formulaName: string,
  positions: Record<string, Point>,
): Promise<void> {
  const filePath = layoutFilePath(projectDir, formulaName);
  const body = JSON.stringify(
    {
      nodes: Object.entries(positions).map(([id, point]) => ({
        id,
        x: point.x,
        y: point.y,
      })),
    },
    null,
    2,
  );
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${body}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readRun(
  projectDir: string,
  formulaName: string,
): Promise<RunSnapshot | null> {
  try {
    return JSON.parse(
      await readFile(runFilePath(projectDir, formulaName), "utf8"),
    ) as RunSnapshot;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
