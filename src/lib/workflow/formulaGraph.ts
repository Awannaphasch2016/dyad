/**
 * Pure translation between a Gas City v2 formula TOML subset and a graph of
 * formula nodes. Every node is the same kind. An edge A → B means step B
 * lists A in `needs`.
 */

export const REVIEW_PIPELINE_NAME = "review-pipeline";

const FINALIZE_STEP_ID = "workflow-finalize";
const RUN_TARGET_KEY = "gc.run_target";
const HITL_ROLE_KEY = "dyad.hitl_role";

const SUPPORTED_STEP_KEYS = new Set([
  "id",
  "title",
  "description",
  "type",
  "needs",
  "metadata",
]);

export type WorkflowStatus =
  | "idle"
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "skipped"
  | "canceled";

export type FormulaNodeRecord = {
  id: string;
  title: string;
  instructions: string;
  stepType: string;
  runTarget: string | null;
  hitlRole: string | null;
  metadata: Record<string, string>;
};

export type FormulaEdgeRecord = {
  id: string;
  source: string;
  target: string;
};

export type FormulaGraph = {
  formulaName: string;
  description: string;
  nodes: FormulaNodeRecord[];
  edges: FormulaEdgeRecord[];
};

export class FormulaGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaGraphError";
  }
}

export function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

export function exampleReviewPipeline(): FormulaGraph {
  return parseFormulaToml(`formula = "review-pipeline"
description = "Draft, revise, approve, ship"

[requires]
formula_compiler = ">=2.0.0"

[[steps]]
id = "draft"
title = "Draft"
description = "Draft the change."

[[steps]]
id = "revise"
title = "Revise"
needs = ["draft"]

[[steps]]
id = "approve"
title = "Human approval"
type = "gate"
needs = ["revise"]
metadata = { "dyad.hitl_role" = "project-manager" }

[[steps]]
id = "ship"
title = "Ship"
needs = ["approve"]
`);
}

export function emptyFormula(formulaName: string): FormulaGraph {
  return { formulaName, description: "", nodes: [], edges: [] };
}

type ParsedStep = {
  node: FormulaNodeRecord;
  needs: string[];
  unsupported: string[];
};

export function parseFormulaToml(source: string): FormulaGraph {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let formulaName = "";
  let description = "";
  const steps: ParsedStep[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "[[steps]]") {
      const parsed = parseStep(lines, index + 1);
      index = parsed.nextIndex;
      if (!isFinalizeStep(parsed.step.node.id)) steps.push(parsed.step);
      continue;
    }
    if (trimmed.startsWith("formula ")) {
      formulaName = readStringAssignment(trimmed, "formula");
    } else if (trimmed.startsWith("description ")) {
      description = readStringAssignment(trimmed, "description");
    }
    index += 1;
  }

  if (!formulaName) {
    throw new FormulaGraphError("Formula is missing its formula name.");
  }

  const unsupported = steps.flatMap((step) =>
    step.unsupported.map((key) => `${step.node.id}: ${key}`),
  );
  if (unsupported.length > 0) {
    throw new FormulaGraphError(
      `This editor only writes formula steps. Unsupported fields: ${unsupported.join("; ")}`,
    );
  }

  const nodes = steps.map((step) => step.node);
  assertUniqueIds(nodes);
  const edges = steps.flatMap((step) =>
    step.needs
      .filter((source) => !isFinalizeStep(source))
      .map((source) => ({
        id: edgeId(source, step.node.id),
        source,
        target: step.node.id,
      })),
  );
  const graph = { formulaName, description, nodes, edges };
  assertAcyclic(graph);
  return graph;
}

export function serializeFormulaToml(graph: FormulaGraph): string {
  assertAcyclic(graph);
  assertUniqueIds(graph.nodes);
  const needsByTarget = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = needsByTarget.get(edge.target) ?? [];
    list.push(edge.source);
    needsByTarget.set(edge.target, list);
  }

  const lines = [
    `formula = ${tomlString(graph.formulaName)}`,
    `description = ${tomlString(graph.description)}`,
    "",
    "[requires]",
    'formula_compiler = ">=2.0.0"',
    "",
  ];

  for (const node of graph.nodes) {
    if (isFinalizeStep(node.id)) continue;
    lines.push("[[steps]]");
    lines.push(`id = ${tomlString(node.id)}`);
    lines.push(`title = ${tomlString(node.title)}`);
    if (node.instructions) {
      lines.push(`description = ${tomlString(node.instructions)}`);
    }
    if (node.stepType && node.stepType !== "task") {
      lines.push(`type = ${tomlString(node.stepType)}`);
    }
    const needs = needsByTarget.get(node.id) ?? [];
    if (needs.length > 0) {
      lines.push(`needs = [${needs.map(tomlString).join(", ")}]`);
    }
    const metadata = metadataForNode(node);
    if (Object.keys(metadata).length > 0) {
      const pairs = Object.entries(metadata).map(
        ([key, value]) => `${tomlString(key)} = ${tomlString(value)}`,
      );
      lines.push(`metadata = { ${pairs.join(", ")} }`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function assertAcyclic(graph: FormulaGraph): void {
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.source) || !outgoing.has(edge.target)) {
      throw new FormulaGraphError(
        `Edge ${edge.source} → ${edge.target} names a missing formula node.`,
      );
    }
    outgoing.get(edge.source)?.push(edge.target);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new FormulaGraphError(
        `Formula "${graph.formulaName}" contains a cycle through ${id}.`,
      );
    }
    visiting.add(id);
    for (const next of outgoing.get(id) ?? []) walk(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of graph.nodes) walk(node.id);
}

function parseStep(
  lines: string[],
  start: number,
): { step: ParsedStep; nextIndex: number } {
  const raw = new Map<string, string>();
  const unsupported: string[] = [];
  let index = start;
  while (index < lines.length && (lines[index] ?? "").trim() !== "[[steps]]") {
    const trimmed = (lines[index] ?? "").trim();
    index += 1;
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
      continue;
    }
    const key = trimmed.split(/\s+/, 1)[0] ?? "";
    if (!SUPPORTED_STEP_KEYS.has(key)) {
      unsupported.push(key);
      continue;
    }
    raw.set(key, trimmed);
  }

  const metadata = parseMetadata(raw.get("metadata") ?? "");
  const node: FormulaNodeRecord = {
    id: raw.has("id") ? readStringAssignment(raw.get("id") ?? "", "id") : "",
    title: raw.has("title")
      ? readStringAssignment(raw.get("title") ?? "", "title")
      : "",
    instructions: raw.has("description")
      ? readStringAssignment(raw.get("description") ?? "", "description")
      : "",
    stepType: raw.has("type")
      ? readStringAssignment(raw.get("type") ?? "", "type")
      : "task",
    runTarget: metadata[RUN_TARGET_KEY] ?? null,
    hitlRole: metadata[HITL_ROLE_KEY] ?? null,
    metadata: withoutRouteKeys(metadata),
  };
  if (!node.id) {
    throw new FormulaGraphError("A formula step is missing an id.");
  }
  return {
    step: {
      node,
      needs: readStringList(raw.get("needs") ?? ""),
      unsupported,
    },
    nextIndex: index,
  };
}

function withoutRouteKeys(
  metadata: Record<string, string>,
): Record<string, string> {
  const copy = { ...metadata };
  delete copy[RUN_TARGET_KEY];
  delete copy[HITL_ROLE_KEY];
  return copy;
}

function metadataForNode(node: FormulaNodeRecord): Record<string, string> {
  const metadata = { ...node.metadata };
  if (node.runTarget) metadata[RUN_TARGET_KEY] = node.runTarget;
  if (node.hitlRole) metadata[HITL_ROLE_KEY] = node.hitlRole;
  return metadata;
}

function readStringList(assignment: string): string[] {
  if (!assignment) return [];
  const match = assignment.match(/=\s*\[(.*)\]\s*$/);
  if (!match) return [];
  return [...(match[1] ?? "").matchAll(/"((?:\\.|[^"\\])*)"/g)].map((found) =>
    unescapeToml(found[1] ?? ""),
  );
}

function parseMetadata(assignment: string): Record<string, string> {
  if (!assignment) return {};
  const match = assignment.match(/=\s*\{(.*)\}\s*$/);
  if (!match) return {};
  const metadata: Record<string, string> = {};
  for (const pair of (match[1] ?? "").matchAll(
    /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/g,
  )) {
    metadata[unescapeToml(pair[1] ?? "")] = unescapeToml(pair[2] ?? "");
  }
  return metadata;
}

function readStringAssignment(line: string, key: string): string {
  const match = line.match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`));
  if (!match) {
    throw new FormulaGraphError(`Could not read ${key} from "${line}".`);
  }
  return unescapeToml(match[1] ?? "");
}

function tomlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function unescapeToml(value: string): string {
  return value.replace(/\\(\\|"|n)/g, (_match, escaped: string) => {
    if (escaped === "n") return "\n";
    if (escaped === '"') return '"';
    return "\\";
  });
}

function assertUniqueIds(nodes: FormulaNodeRecord[]): void {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new FormulaGraphError(`Formula step id "${node.id}" is repeated.`);
    }
    seen.add(node.id);
  }
}

function isFinalizeStep(id: string): boolean {
  return id === FINALIZE_STEP_ID || id.endsWith(`.${FINALIZE_STEP_ID}`);
}
