import type { FactoryPhase } from "@/lib/factoryPhase";
import { factoryPhaseSummaryHeading } from "@/lib/factoryPhase";
import { extractFactoryRequest } from "@/lib/factoryRequest";

/**
 * `completed` is the local run status for the table's `finished`.
 * `rejected` is a run that never started. It is an unclear stop, not a question.
 */
export const FACTORY_STOP_STATUSES = [
  "finished",
  "completed",
  "errored",
  "cancelled",
  "expired",
  "rejected",
] as const;

export type FactoryStopStatus = (typeof FACTORY_STOP_STATUSES)[number];

export type FactoryStopClass =
  | "question_opened"
  | "agent_finished"
  | "agent_stopped_unclear"
  | "agent_failed";

const FENCE = /^\s*```/;
const HEADING = /^\s*#{1,4}\s*(.+?)\s*$/;

function headingText(line: string): string | null {
  const match = HEADING.exec(line);
  if (!match?.[1]) return null;
  return match[1].replace(/\*/g, "").replace(/:\s*$/, "").trim().toLowerCase();
}

/**
 * Bullets under the last `## Phase finished` outside a fence. A summary
 * heading is not a finish. An empty list is not a finish.
 */
export function extractPhaseFinished(content: string): string | null {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lines = withoutThinking.split(/\r?\n/);
  let fenced = false;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (headingText(line) === "phase finished") start = index;
  }
  if (start < 0) return null;
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (FENCE.test(line)) break;
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      bullets.push(line.trimEnd());
      continue;
    }
    if (line.trim() === "") {
      if (bullets.length > 0) break;
      continue;
    }
    if (bullets.length > 0 && /^\s{2,}\S/.test(line)) {
      bullets.push(line.trimEnd());
      continue;
    }
    break;
  }
  return bullets.length > 0 ? bullets.join("\n") : null;
}

/** The summary hook's chat message. Null when the finish has no bullets. */
export function phaseSummaryFromFinish(
  phase: FactoryPhase,
  content: string,
): string | null {
  const bullets = extractPhaseFinished(content);
  if (!bullets) return null;
  return `## ${factoryPhaseSummaryHeading(phase)}\n${bullets}`;
}

/**
 * Sort a finished turn. A request beats a finish marker. A summary heading
 * is not a finish. An error is never a question.
 */
export function classifyFactoryStop(input: {
  status: FactoryStopStatus;
  finalMessage: string | null;
  phase: FactoryPhase;
}): FactoryStopClass {
  if (
    input.status === "cancelled" ||
    input.status === "expired" ||
    input.status === "rejected"
  ) {
    return "agent_stopped_unclear";
  }
  if (input.status === "errored") return "agent_failed";
  const message = input.finalMessage ?? "";
  if (extractFactoryRequest(message)) return "question_opened";
  if (extractPhaseFinished(message)) return "agent_finished";
  return "agent_stopped_unclear";
}
