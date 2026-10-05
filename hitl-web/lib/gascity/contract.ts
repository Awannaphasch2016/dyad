import type { ElectronCapability } from "../boundary";

/** Browser → GasCity. Electron is not on this path. */
export const GAS_CITY_PATHS = {
  runs: "/v1/runs",
  questions: "/v1/hitl/questions",
  answer: (questionId: string) =>
    `/v1/hitl/questions/${encodeURIComponent(questionId)}/answers`,
  electronCapability: "/v1/capabilities/electron",
} as const;

export const MAX_PROMPT_CHARS = 20_000;
export const MAX_ANSWER_CHARS = 20_000;

export interface RunRequest {
  idempotencyKey: string;
  prompt: string;
}

export interface RunAccepted {
  runId: string;
  status: "accepted";
  orchestration: "gascity";
  electronInvoked: false;
}

export interface ElectronCapabilityRequest {
  capability: ElectronCapability;
  reason: string;
}

export interface ElectronCapabilityResponse {
  disposition: "electron-required";
  capability: ElectronCapability;
  electronInvoked: false;
}

export interface GasCityError {
  error: string;
}

export function parseRunRequest(value: unknown): RunRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const idempotencyKey =
    typeof record.idempotencyKey === "string"
      ? record.idempotencyKey.trim()
      : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return null;
  if (!idempotencyKey || idempotencyKey.length > 256) return null;
  return { prompt, idempotencyKey };
}

export function parseAnswerBody(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const body = (value as { body?: unknown }).body;
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_ANSWER_CHARS) return null;
  return trimmed;
}

export function parseElectronCapabilityRequest(
  value: unknown,
  isCapability: (value: unknown) => boolean,
): ElectronCapabilityRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isCapability(record.capability)) return null;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason || reason.length > 500) return null;
  return {
    capability: record.capability as ElectronCapability,
    reason,
  };
}
