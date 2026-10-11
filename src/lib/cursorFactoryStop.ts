import type { FactoryPhase } from "@/lib/factoryPhase";
import {
  classifyFactoryStop,
  type FactoryStopClass,
  type FactoryStopStatus,
} from "@/lib/factoryStop";

/**
 * Cursor's terminal run statuses. `FINISHED` is the local `completed`
 * status: a request still beats a summary.
 */
const CURSOR_STATUS_TO_FACTORY: Record<string, FactoryStopStatus> = {
  FINISHED: "completed",
  ERROR: "errored",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

/** `null` while the run is still creating or running. */
export function factoryStatusForCursorRun(
  cursorStatus: string,
): FactoryStopStatus | null {
  return CURSOR_STATUS_TO_FACTORY[cursorStatus.trim().toUpperCase()] ?? null;
}

/** The A2 classifier for a Cursor run status and its final message. */
export function classifyCursorFactoryStop(input: {
  cursorStatus: string;
  finalMessage: string | null;
  phase: FactoryPhase;
}): FactoryStopClass | null {
  const status = factoryStatusForCursorRun(input.cursorStatus);
  if (!status) return null;
  return classifyFactoryStop({
    status,
    finalMessage: input.finalMessage,
    phase: input.phase,
  });
}
