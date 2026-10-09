import {
  extractFactoryPhaseSummary,
  type FactoryPhase,
} from "@/lib/factoryPhase";
import { extractFactoryRequest } from "@/lib/factoryRequest";

/**
 * `completed` is the local run status for the table's `finished`.
 * `rejected` is a run that never started; it is abandoned, not a human request.
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
  | "human-required"
  | "ready-for-approval"
  | "completed-unverified"
  | "recoverable-failure"
  | "infrastructure-error"
  | "abandoned";

function hasMessage(finalMessage: string | null): boolean {
  return (finalMessage ?? "").trim().length > 0;
}

/** Sort a finished run. A request beats a phase summary. An error is never a human request. */
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
    return "abandoned";
  }
  if (input.status === "errored") {
    return hasMessage(input.finalMessage)
      ? "recoverable-failure"
      : "infrastructure-error";
  }
  const message = input.finalMessage ?? "";
  if (extractFactoryRequest(message)) return "human-required";
  if (extractFactoryPhaseSummary(message, input.phase)) {
    return "ready-for-approval";
  }
  return "completed-unverified";
}
