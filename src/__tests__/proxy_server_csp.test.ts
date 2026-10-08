import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";
import { CANARY_PAGE_ORIGIN } from "../preview_iframe/public_preview_url";

const WORKER_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "worker",
  "proxy_server.js",
);
const PROXY_FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' file: http://localhost:* http://127.0.0.1:* http://[::1]:*";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function startUpstream({
  body = "ok",
  contentType = "text/plain",
  headers = {},
}: {
  body?: string;
  contentType?: string;
  headers?: http.OutgoingHttpHeaders;
} = {}): Promise<{
  close: () => Promise<void>;
  origin: string;
  headers: () => http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    let lastHeaders: http.IncomingHttpHeaders = {};
    const server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      res.writeHead(200, {
        "content-length": Buffer.byteLength(body),
        "content-type": contentType,
        ...headers,
      });
      res.end(body);
    });
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        close: () => new Promise<void>((res) => server.close(() => res())),
        origin: `http://localhost:${port}`,
        headers: () => lastHeaders,
      });
    });
  });
}

function rawHeaderValues(rawHeaders: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === name.toLowerCase()) {
      values.push(rawHeaders[i + 1]);
    }
  }
  return values;
}

describe("proxy worker Content-Security-Policy", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0)) {
      await fn();
    }
  });

  function startWorker(workerData: Record<string, unknown>): {
    waitForStart: () => Promise<number>;
  } {
    const worker = new Worker(WORKER_PATH, { workerData });
    cleanup.push(async () => {
      await worker.terminate();
    });
    const messages: string[] = [];
    const waiters: Array<{
      predicate: (m: string) => boolean;
      resolve: (m: string) => void;
    }> = [];
    worker.on("message", (m) => {
      if (typeof m !== "string") return;
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(m)) {
          waiters[i].resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    const waitFor = (predicate: (m: string) => boolean) =>
      new Promise<string>((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for worker message")),
          10_000,
        );
        waiters.push({
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    return {
      waitForStart: async () => {
        const msg = await waitFor((m) =>
          m.startsWith("proxy-server-start url="),
        );
        return Number(msg.match(/:(\d+)\b/)?.[1]);
      },
    };
  }

  async function proxyResponse(
    upstreamOpts?: Parameters<typeof startUpstream>[0],
    request: {
      headers?: http.OutgoingHttpHeaders;
      ancestors?: string[];
    } = {},
  ) {
    const upstream = await startUpstream(upstreamOpts);
    cleanup.push(upstream.close);

    const port = await findFreePort();
    const { waitForStart } = startWorker({
      fallbackPortStart: await findFreePort(),
      maxPortAttempts: 20,
      port,
      targetOrigin: upstream.origin,
      ...(request.ancestors
        ? { publicPreviewFrameAncestors: request.ancestors }
        : {}),
    });
    const proxyPort = await waitForStart();

    return new Promise<{
      body: string;
      headers: http.IncomingHttpHeaders;
      rawHeaders: string[];
      upstreamHeaders: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.get(
        {
          host: "localhost",
          path: "/",
          port: proxyPort,
          headers: request.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () =>
            resolve({
              body: Buffer.concat(chunks).toString("utf8"),
              headers: res.headers,
              rawHeaders: res.rawHeaders,
              upstreamHeaders: upstream.headers(),
            }),
          );
        },
      );
      req.once("error", reject);
    });
  }

  it("adds the proxy frame-ancestors policy when the app has no CSP", async () => {
    const response = await proxyResponse();

    expect(
      rawHeaderValues(response.rawHeaders, "content-security-policy"),
    ).toEqual([PROXY_FRAME_ANCESTORS_CSP]);
  });

  it("preserves an app CSP as an independently enforced header", async () => {
    const appCsp = "default-src 'self'; script-src 'self'";
    const response = await proxyResponse({
      headers: {
        "content-security-policy": appCsp,
      },
    });

    expect(
      rawHeaderValues(response.rawHeaders, "content-security-policy"),
    ).toEqual([appCsp, PROXY_FRAME_ANCESTORS_CSP]);
  });

  it("keeps app CSP independent on the HTML injection path", async () => {
    const appCsp = "default-src 'self'";
    const response = await proxyResponse({
      body: "<html><head></head><body>hello</body></html>",
      contentType: "text/html",
      headers: {
        "content-security-policy": appCsp,
      },
    });

    expect(response.body).toContain("<body>hello</body>");
    expect(
      rawHeaderValues(response.rawHeaders, "content-security-policy"),
    ).toEqual([appCsp, PROXY_FRAME_ANCESTORS_CSP]);
  });

  it("lets the canary page frame the preview and refuses every other parent", async () => {
    const allowed = await proxyResponse(
      {
        body: "<html><head></head><body>surf</body></html>",
        contentType: "text/html",
      },
      {
        headers: { "x-dyad-preview-ancestor": CANARY_PAGE_ORIGIN },
      },
    );
    expect(allowed.body).toContain("<body>surf</body>");
    expect(
      rawHeaderValues(allowed.rawHeaders, "content-security-policy"),
    ).toEqual([`${PROXY_FRAME_ANCESTORS_CSP} ${CANARY_PAGE_ORIGIN}`]);
    expect(allowed.upstreamHeaders["x-dyad-preview-ancestor"]).toBeUndefined();

    const refused = await proxyResponse(undefined, {
      headers: { "x-dyad-preview-ancestor": "https://evil.example" },
    });
    expect(
      rawHeaderValues(refused.rawHeaders, "content-security-policy"),
    ).toEqual([PROXY_FRAME_ANCESTORS_CSP]);

    const emptyAllowlist = await proxyResponse(undefined, {
      ancestors: [],
      headers: { "x-dyad-preview-ancestor": CANARY_PAGE_ORIGIN },
    });
    expect(
      rawHeaderValues(emptyAllowlist.rawHeaders, "content-security-policy"),
    ).toEqual([PROXY_FRAME_ANCESTORS_CSP]);
  });
});
