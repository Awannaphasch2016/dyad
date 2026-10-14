import { FORMULA_PHASES, type FormulaPhase } from "./phases";

const BLOCKED_PATH_PARTS = ["/cook", "/sling", "/beads", "/bead/"];

export type FormulaHttpResponse = {
  status: number;
  text: () => Promise<string>;
};

export type FormulaFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FormulaHttpResponse>;

export type FormulaSupervisor = {
  baseUrl: string;
  cityName: string;
  writeGrant: string | null;
};

export class FormulaRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FormulaRequestError";
    this.status = status;
  }
}

export function formulaRequestPath(
  cityName: string,
  phase: FormulaPhase,
  operation: "source" | "validate" | "upsert",
): string {
  if (!(FORMULA_PHASES as readonly string[]).includes(phase)) {
    throw new FormulaRequestError(`Unknown formula phase ${phase}`, 400);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(cityName)) {
    throw new FormulaRequestError("GasCity city name is not valid.", 400);
  }
  const city = encodeURIComponent(cityName);
  const name = encodeURIComponent(phase);
  const suffix =
    operation === "source"
      ? "/source"
      : operation === "validate"
        ? "/validate"
        : "";
  const path = `/v0/city/${city}/formulas/${name}${suffix}`;
  assertConfigurablePath(path);
  return path;
}

export function readSupervisorConfig(
  env: NodeJS.ProcessEnv,
): FormulaSupervisor | null {
  const baseUrl = env.GAS_CITY_SUPERVISOR_URL?.trim() ?? "";
  const cityName = env.GAS_CITY_CITY_NAME?.trim() ?? "";
  if (!baseUrl || !cityName) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new FormulaRequestError(
      "GasCity supervisor address is not a URL.",
      400,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FormulaRequestError(
      "GasCity supervisor address must be http or https.",
      400,
    );
  }
  const writeGrant = env.GAS_CITY_CITY_WRITE_GRANT?.trim() || null;
  return { baseUrl: parsed.toString(), cityName, writeGrant };
}

export async function loadFormulaSource(
  supervisor: FormulaSupervisor,
  phase: FormulaPhase,
  fetchImpl: FormulaFetch,
): Promise<string | null> {
  const response = await request(supervisor, phase, "source", fetchImpl);
  if (response.status === 404) return null;
  const body = await readBody(response);
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, body);
  }
  if (!body || typeof body.source !== "string") {
    throw new FormulaRequestError(
      "GasCity formula source response has no text.",
      response.status,
    );
  }
  return body.source;
}

export async function validateFormulaText(
  supervisor: FormulaSupervisor,
  phase: FormulaPhase,
  text: string,
  fetchImpl: FormulaFetch,
): Promise<{ valid: boolean; errors: string[] }> {
  const response = await request(supervisor, phase, "validate", fetchImpl, {
    method: "POST",
    body: text,
    grant: false,
  });
  const body = await readBody(response);
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, body);
  }
  return {
    valid: body?.valid === true,
    errors: stringList(body?.errors),
  };
}

export async function upsertFormulaText(
  supervisor: FormulaSupervisor,
  phase: FormulaPhase,
  text: string,
  fetchImpl: FormulaFetch,
): Promise<void> {
  const response = await request(supervisor, phase, "upsert", fetchImpl, {
    method: "PUT",
    body: text,
    grant: true,
  });
  const body = await readBody(response);
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status, body);
  }
}

async function request(
  supervisor: FormulaSupervisor,
  phase: FormulaPhase,
  operation: "source" | "validate" | "upsert",
  fetchImpl: FormulaFetch,
  init: { method?: string; body?: string; grant?: boolean } = {},
): Promise<FormulaHttpResponse> {
  const path = formulaRequestPath(supervisor.cityName, phase, operation);
  const url = new URL(path, supervisor.baseUrl);
  assertConfigurablePath(url.pathname);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-GC-Request": "formula-page",
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "text/plain; charset=utf-8";
  }
  if (init.grant && supervisor.writeGrant) {
    headers["X-GC-City-Write"] = supervisor.writeGrant;
  }
  return fetchImpl(url.toString(), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

function assertConfigurablePath(path: string): void {
  const lowered = path.toLowerCase();
  for (const blocked of BLOCKED_PATH_PARTS) {
    if (lowered.includes(blocked)) {
      throw new FormulaRequestError(
        "Formula pages do not cook or run beads.",
        400,
      );
    }
  }
}

async function readBody(
  response: FormulaHttpResponse,
): Promise<Record<string, unknown> | null> {
  const raw = await response.text();
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { detail: raw.slice(0, 500) };
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function httpError(
  status: number,
  body: Record<string, unknown> | null,
): FormulaRequestError {
  const errors = stringList(body?.errors);
  const detail = typeof body?.detail === "string" ? body.detail : "";
  const messageText = typeof body?.message === "string" ? body.message : "";
  const message =
    errors[0] || detail || messageText || `GasCity returned ${status}`;
  return new FormulaRequestError(message, status);
}
