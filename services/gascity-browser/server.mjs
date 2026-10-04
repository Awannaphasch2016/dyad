import { createServer } from "node:http";
import { continueRun } from "./continue.mjs";

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

function originAllowed(origin, origins, allowVercelPreviews) {
  if (origins.has(origin)) return true;
  if (!allowVercelPreviews) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function corsHeaders(request, origins, allowVercelPreviews) {
  const origin = request.headers.origin;
  if (!origin) return { ok: true, headers: {} };
  if (!originAllowed(origin, origins, allowVercelPreviews)) {
    return { ok: false, headers: {} };
  }
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
  const allowVercelPreviews = options.allowVercelPreviews === true;
  const continueRun = options.continueRun ?? null;
  const log = options.log ?? (() => {});
  return createServer(async (request, response) => {
    const cors = corsHeaders(request, origins, allowVercelPreviews);
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
    if (
      !authorization.startsWith("Bearer ") ||
      authorization.trim().length < 12
    ) {
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
        const prompt = body.prompt.trim();
        if (!continueRun) {
          log(
            `run refused promptChars=${prompt.length} dyad=skipped electronInvoked=false`,
          );
          send(
            response,
            503,
            {
              error: "Question store is unavailable.",
              electronInvoked: false,
            },
            cors.headers,
          );
          return;
        }
        let continued;
        try {
          continued = await continueRun({
            prompt,
            idempotencyKey: body.idempotencyKey.trim(),
          });
        } catch {
          send(
            response,
            503,
            {
              error: "Question store is unavailable.",
              electronInvoked: false,
            },
            cors.headers,
          );
          return;
        }
        const dyadStatus = continued.dyadStatus;
        const accepted =
          typeof dyadStatus === "number" &&
          dyadStatus >= 200 &&
          dyadStatus < 300;
        if (!accepted) {
          log(
            `run refused ${continued.runId} promptChars=${prompt.length} dyad=${dyadStatus ?? "skipped"} electronInvoked=false`,
          );
          if (
            typeof dyadStatus === "number" &&
            dyadStatus >= 400 &&
            dyadStatus <= 599
          ) {
            send(
              response,
              dyadStatus,
              {
                error: "Dyad did not accept the run.",
                runId: continued.runId,
                dyadStatus,
                electronInvoked: false,
              },
              cors.headers,
            );
            return;
          }
          send(
            response,
            503,
            {
              error: "Question store is unavailable.",
              runId: continued.runId,
              electronInvoked: false,
            },
            cors.headers,
          );
          return;
        }
        log(
          `run accepted ${continued.runId} promptChars=${prompt.length} dyad=${dyadStatus} electronInvoked=false`,
        );
        send(
          response,
          202,
          {
            runId: continued.runId,
            status: "accepted",
            orchestration: "gascity",
            electronInvoked: false,
          },
          cors.headers,
        );
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/capabilities/electron"
      ) {
        const body = await readJson(request);
        const reason =
          typeof body?.reason === "string" ? body.reason.trim() : "";
        if (
          !CAPABILITIES.has(body?.capability) ||
          !reason ||
          reason.length > 500
        ) {
          send(
            response,
            400,
            { error: "Unknown Electron capability." },
            cors.headers,
          );
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

async function openQuery(uri) {
  const postgres = (await import("postgres")).default;
  const sql = postgres(uri, { max: 1, ssl: "require" });
  return (text, params) => sql.unsafe(text, params);
}

function listenHost() {
  const host = process.env.GAS_CITY_BROWSER_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("GAS_CITY_BROWSER_HOST must be 127.0.0.1 or 0.0.0.0");
  }
  return host;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origins = (process.env.GAS_CITY_BROWSER_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const port = Number(process.env.PORT ?? "8787");
  const databaseUrl = process.env.WEWEBPLUS_DATABASE_URL || "";
  const query = databaseUrl ? await openQuery(databaseUrl) : null;
  const server = createGasCityBrowserServer({
    origins,
    allowVercelPreviews:
      process.env.GAS_CITY_BROWSER_ALLOW_VERCEL_PREVIEWS === "1",
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
    continueRun: query
      ? (input) =>
          continueRun({
            ...input,
            query,
            dyadFetch: fetch,
            dyadBase: process.env.WEAVER_BASE_URL || "http://dyad:32100",
            bridgeToken: process.env.GAS_CITY_HOST_BRIDGE_TOKEN || "",
          })
      : null,
  });
  server.listen(port, listenHost());
}
