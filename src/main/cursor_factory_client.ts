import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export interface CursorRunSnapshot {
  status: string;
  message: string | null;
}

export interface CursorFactoryClient {
  getRun(agentId: string, runId: string): Promise<CursorRunSnapshot>;
  followUp(agentId: string, prompt: string): Promise<{ cursorRunId: string }>;
  createAgent(input: {
    name: string;
    prompt: string;
    repository: string | null;
    ref: string | null;
  }): Promise<{ agentId: string; cursorRunId: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function messageFrom(json: Record<string, unknown> | null): string | null {
  if (!json) return null;
  if (typeof json.result === "string") return json.result;
  const result = asRecord(json.result);
  if (result && typeof result.text === "string") return result.text;
  return null;
}

function publicError(
  status: number,
  json: Record<string, unknown> | null,
  key: string,
): string {
  const raw = json?.message ?? json?.error;
  const text =
    typeof raw === "string" ? raw : `Cursor request failed (${status})`;
  return text.split(key).join("[redacted]").slice(0, 180);
}

async function readJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return { message: text.slice(0, 180) };
  }
}

/** Cursor Cloud Agent HTTP client. The key stays in this process. */
export function cursorApiClient(
  key: string,
  fetchImpl: typeof fetch = fetch,
): CursorFactoryClient {
  const secret = key.trim();
  async function request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const response = await fetchImpl(`https://api.cursor.com${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await readJson(response);
    return { status: response.status, json };
  }

  return {
    async getRun(agentId, runId) {
      const result = await request(
        "GET",
        `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
      );
      if (result.status === 401 || result.status === 403) {
        throw new DyadError(
          "Cursor rejected the factory key.",
          DyadErrorKind.Auth,
        );
      }
      if (result.status !== 200) {
        throw new DyadError(
          publicError(result.status, result.json, secret),
          DyadErrorKind.External,
        );
      }
      return {
        status: String(result.json?.status ?? ""),
        message: messageFrom(result.json),
      };
    },
    async followUp(agentId, prompt) {
      let last = "Cursor follow-up failed.";
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await request(
          "POST",
          `/v1/agents/${encodeURIComponent(agentId)}/runs`,
          { autoCreatePR: false, prompt: { text: prompt } },
        );
        const run = asRecord(result.json?.run);
        const runId = run?.id;
        if (
          (result.status === 200 || result.status === 201) &&
          typeof runId === "string"
        ) {
          return { cursorRunId: runId };
        }
        last = publicError(result.status, result.json, secret);
        if (result.status !== 409) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      throw new DyadError(last, DyadErrorKind.External);
    },
    async createAgent(input) {
      const body: Record<string, unknown> = {
        name: input.name,
        autoCreatePR: false,
        prompt: { text: input.prompt },
      };
      if (input.repository) {
        body.source = {
          repository: input.repository,
          ref: input.ref || "main",
        };
      }
      const result = await request("POST", "/v1/agents", body);
      const agent = asRecord(result.json?.agent);
      const run = asRecord(result.json?.run);
      if (
        (result.status === 200 || result.status === 201) &&
        typeof agent?.id === "string" &&
        typeof run?.id === "string"
      ) {
        return { agentId: agent.id, cursorRunId: run.id };
      }
      const kind =
        result.status === 401 || result.status === 403
          ? DyadErrorKind.Auth
          : DyadErrorKind.External;
      throw new DyadError(
        publicError(result.status, result.json, secret),
        kind,
      );
    },
  };
}

export function cursorFactoryClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): CursorFactoryClient | null {
  const key = env.CURSOR_API_KEY?.trim();
  if (!key) return null;
  return cursorApiClient(key, fetchImpl);
}
