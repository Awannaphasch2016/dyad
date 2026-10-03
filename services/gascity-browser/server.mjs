import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const CAPABILITIES = new Set([
  "filesystem",
  "git",
  "native-dialog",
  "preview",
  "safe-storage",
  "terminal",
]);

function send(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

function corsHeaders(request, origins) {
  const origin = request.headers.origin;
  if (!origin) return { ok: true, headers: {} };
  if (!origins.has(origin)) return { ok: false, headers: {} };
  return {
    ok: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      vary: "origin",
    },
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error("too-large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validRun(value) {
  if (!value || typeof value !== "object") return false;
  const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
  const key =
    typeof value.idempotencyKey === "string" ? value.idempotencyKey.trim() : "";
  return Boolean(prompt) && prompt.length <= 20_000 && key && key.length <= 256;
}

/**
 * Browser-facing GasCity listener.
 * `origins` is the allowlist for browser Origin headers. A request with no
 * Origin is a server-to-server call and is allowed.
 * `invokeElectron` is omitted unless GasCity has decided a machine-local
 * capability must run. The default listener never calls Electron.
 */
export function createGasCityBrowserServer(options = {}) {
  const origins = new Set(options.origins ?? []);
  const invokeElectron = options.invokeElectron ?? null;
  return createServer(async (request, response) => {
    const cors = corsHeaders(request, origins);
    if (!cors.ok) {
      send(response, 403, { error: "Origin is not allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors.headers);
      response.end();
      return;
    }
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.trim().length < 12) {
      send(response, 401, { error: "Sign in to continue." }, cors.headers);
      return;
    }
    const url = new URL(request.url ?? "/", "http://gascity.local");
    try {
      if (request.method === "POST" && url.pathname === "/v1/runs") {
        const body = await readJson(request);
        if (!validRun(body)) {
          send(response, 400, { error: "Enter a prompt." }, cors.headers);
          return;
        }
        send(
          response,
          202,
          {
            runId: `gascity-run:${randomUUID()}`,
            status: "accepted",
            orchestration: "gascity",
            electronInvoked: false,
          },
          cors.headers,
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/capabilities/electron") {
        const body = await readJson(request);
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        if (!CAPABILITIES.has(body?.capability) || !reason || reason.length > 500) {
          send(response, 400, { error: "Unknown Electron capability." }, cors.headers);
          return;
        }
        if (invokeElectron) await invokeElectron(body.capability);
        send(
          response,
          409,
          {
            disposition: "electron-required",
            capability: body.capability,
            electronInvoked: Boolean(invokeElectron),
          },
          cors.headers,
        );
        return;
      }
      if (url.pathname.startsWith("/v1/hitl/")) {
        send(
          response,
          503,
          { error: "Question store is unavailable." },
          cors.headers,
        );
        return;
      }
      send(response, 404, { error: "Not found" }, cors.headers);
    } catch {
      send(response, 400, { error: "Invalid JSON body" }, cors.headers);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origins = (process.env.GAS_CITY_BROWSER_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const port = Number(process.env.PORT ?? "8787");
  const server = createGasCityBrowserServer({ origins });
  server.listen(port, "127.0.0.1");
}
