/**
 * Serves the existing renderer on 127.0.0.1 and gives that page a
 * window.electron that calls the main-process handlers. A Cloudflare tunnel
 * in front of this port is how the same Dyad UI opens in a browser.
 *
 * In development the Vite dev server is proxied (HMR included). In a packaged
 * build the renderer files next to the main bundle are served directly.
 *
 * Started only when DYAD_BROWSER_BRIDGE=1. The desktop BrowserWindow is
 * unchanged. The preview pane, the terminal, and one-way ipcMain.on sends
 * stay desktop-only.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { WebSocketServer, type WebSocket } from "ws";
import { WEB_BRIDGE_SENDER_ID } from "@/control_plane/session_store";
import { getTrustedIpcHandler } from "@/ipc/handlers/trusted_handle";
import {
  VALID_INVOKE_CHANNELS,
  VALID_RECEIVE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "@/ipc/preload/channels";

const logger = log.scope("browser_bridge");

export const BROWSER_BRIDGE_HOST = "127.0.0.1";
export const BROWSER_BRIDGE_PORT = 8372;
export const BROWSER_BRIDGE_SOCKET_PATH = "/dyad-browser-ipc";
const SESSION_TOKEN_CHANNEL = "clerk:set-session-token";
const BRIDGE_MARKER = "data-dyad-browser-bridge";

const invokeChannels = new Set<string>(VALID_INVOKE_CHANNELS);
const sendChannels = new Set<string>(VALID_SEND_CHANNELS);

export type BrowserBridgePush = {
  channel: string;
  args: unknown[];
};

export type BrowserBridge = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

type BridgeSocketMessage =
  | { id: number; type: "result"; result: unknown }
  | { id: number; type: "error"; message: string }
  | { type: "event"; channel: string; args: unknown[] };

let activeBridge: BrowserBridge | null = null;

export function browserBridgeInvokeArgs(
  channel: string,
  args: readonly unknown[],
): unknown[] {
  if (channel !== SESSION_TOKEN_CHANNEL) return [...args];
  const [first, ...rest] = args;
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return [...args];
  }
  return [{ ...(first as Record<string, unknown>), bridge: true }, ...rest];
}

export function browserBridgeClientScript(): string {
  const invoke = JSON.stringify([...VALID_INVOKE_CHANNELS]);
  const send = JSON.stringify([...VALID_SEND_CHANNELS]);
  const receive = JSON.stringify([...VALID_RECEIVE_CHANNELS]);
  return `(() => {
    const INVOKE = ${invoke};
    const SEND = ${send};
    const RECEIVE = ${receive};
    const listeners = new Map();
    const pending = new Map();
    const queue = [];
    let socket = null;
    let nextId = 1;
    let zoom = 1;
    function invalid(channel) {
      throw new Error("Invalid channel: " + channel);
    }
    function isReceive(channel) {
      return (
        RECEIVE.includes(channel) ||
        channel.startsWith("terminal:data:") ||
        channel.startsWith("terminal:exit:")
      );
    }
    function prepare(channel, args) {
      if (channel !== ${JSON.stringify(SESSION_TOKEN_CHANNEL)}) return args;
      const first = args[0];
      if (!first || typeof first !== "object" || Array.isArray(first)) return args;
      return [{ ...first, bridge: true }, ...args.slice(1)];
    }
    function unwrap(response) {
      if (
        !response ||
        response.__dyadIpcEnvelope !== "dyad-ipc-envelope-v1" ||
        typeof response.ok !== "boolean"
      ) {
        return response;
      }
      if (response.ok) return response.value;
      const error = new Error(
        (response.error && response.error.message) || "IPC failed",
      );
      if (response.error && response.error.name) error.name = response.error.name;
      throw error;
    }
    function failPending(message) {
      for (const [id, wait] of pending) {
        pending.delete(id);
        wait.reject(new Error(message));
      }
    }
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.type === "event") {
        const set = listeners.get(message.channel);
        if (!set) return;
        for (const listener of set) listener(...(message.args || []));
        return;
      }
      const wait = pending.get(message.id);
      if (!wait) return;
      pending.delete(message.id);
      if (message.type === "error") wait.reject(new Error(message.message));
      else wait.resolve(message.result);
    }
    function ensure() {
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(proto + "//" + location.host + ${JSON.stringify(BROWSER_BRIDGE_SOCKET_PATH)});
      socket.addEventListener("open", () => {
        const pendingSends = queue.splice(0);
        for (const payload of pendingSends) socket.send(payload);
      });
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", () => {
        socket = null;
        failPending("Dyad browser bridge disconnected");
        setTimeout(ensure, 500);
      });
    }
    function rpc(type, channel, args) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        // JSON turns a trailing undefined into null, which void inputs reject.
        const trimmed = args.slice();
        while (trimmed.length > 0 && trimmed[trimmed.length - 1] === undefined) {
          trimmed.pop();
        }
        const payload = JSON.stringify({ id, type, channel, args: trimmed });
        ensure();
        if (socket && socket.readyState === 1) socket.send(payload);
        else queue.push(payload);
      });
    }
    window.electron = {
      ipcRenderer: {
        invoke(channel, ...args) {
          if (!INVOKE.includes(channel)) invalid(channel);
          return rpc("invoke", channel, prepare(channel, args)).then(unwrap);
        },
        invokeEnvelope(channel, ...args) {
          if (!INVOKE.includes(channel)) invalid(channel);
          return rpc("invoke", channel, prepare(channel, args));
        },
        send(channel, ...args) {
          if (!SEND.includes(channel)) invalid(channel);
          void rpc("send", channel, prepare(channel, args)).catch((error) => {
            console.error(error);
          });
        },
        on(channel, listener) {
          if (!isReceive(channel)) invalid(channel);
          let set = listeners.get(channel);
          if (!set) {
            set = new Set();
            listeners.set(channel, set);
          }
          set.add(listener);
          return () => set.delete(listener);
        },
        removeAllListeners(channel) {
          if (!isReceive(channel)) return;
          listeners.delete(channel);
        },
        removeListener(channel, listener) {
          if (!isReceive(channel)) return;
          const set = listeners.get(channel);
          if (set) set.delete(listener);
        },
      },
      webFrame: {
        setZoomFactor(factor) {
          zoom = factor;
        },
        getZoomFactor() {
          return zoom;
        },
      },
    };
    ensure();
  })();`;
}

export function injectBrowserBridgeScript(html: string): string {
  if (html.includes(BRIDGE_MARKER)) return html;
  const tag = `<script ${BRIDGE_MARKER}>${browserBridgeClientScript()}</script>`;
  // The packaged renderer uses relative asset URLs for Electron's file load.
  // A <base> of / keeps those URLs on the site root when the browser is on a
  // nested route such as /sign-in/sso-callback.
  const base = /<base\s/i.test(html) ? "" : '<base href="/">';
  const match = /<head[^>]*>/i.exec(html);
  if (!match) return base + tag + html;
  const index = match.index + match[0].length;
  return html.slice(0, index) + base + tag + html.slice(index);
}

function bridgeEvent(
  push: (event: BrowserBridgePush) => void,
): IpcMainInvokeEvent {
  const sender = {
    id: WEB_BRIDGE_SENDER_ID,
    isDestroyed: () => false,
    isCrashed: () => false,
    send: (channel: string, ...args: unknown[]) => push({ channel, args }),
  };
  return { sender } as IpcMainInvokeEvent;
}

export async function dispatchBrowserInvoke(
  channel: string,
  args: readonly unknown[],
  push: (event: BrowserBridgePush) => void,
): Promise<unknown> {
  if (!invokeChannels.has(channel)) {
    throw new Error(`Invalid channel: ${channel}`);
  }
  const handler = getTrustedIpcHandler(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  return handler(bridgeEvent(push), ...browserBridgeInvokeArgs(channel, args));
}

export function dispatchBrowserSend(channel: string): void {
  if (!sendChannels.has(channel)) {
    throw new Error(`Invalid channel: ${channel}`);
  }
}

function readMessage(raw: unknown): {
  id: number;
  type: "invoke" | "send";
  channel: string;
  args: unknown[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as {
    id?: unknown;
    type?: unknown;
    channel?: unknown;
    args?: unknown;
  };
  if (typeof message.id !== "number" || !Number.isInteger(message.id)) {
    return null;
  }
  if (message.type !== "invoke" && message.type !== "send") return null;
  if (typeof message.channel !== "string") return null;
  const args = Array.isArray(message.args) ? message.args : [];
  return { id: message.id, type: message.type, channel: message.channel, args };
}

function messageText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(raw).toString("utf8");
  }
  return String(raw);
}

async function handleSocketMessage(
  raw: unknown,
  push: (event: BrowserBridgePush) => void,
): Promise<BridgeSocketMessage | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageText(raw));
  } catch {
    return null;
  }
  const message = readMessage(parsed);
  if (!message) return null;
  try {
    if (message.type === "send") {
      dispatchBrowserSend(message.channel);
      return { id: message.id, type: "result", result: null };
    }
    const result = await dispatchBrowserInvoke(
      message.channel,
      message.args,
      push,
    );
    return { id: message.id, type: "result", result };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { id: message.id, type: "error", message: text };
  }
}

function sendSocketMessage(socket: WebSocket, message: BridgeSocketMessage) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function proxyHeaders(
  headers: IncomingMessage["headers"],
  targetHost: string,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "accept-encoding" ||
      lower === "content-length"
    ) {
      continue;
    }
    next[key] = value;
  }
  next.host = targetHost;
  next["accept-encoding"] = "identity";
  return next;
}

function proxyHttp(
  devServerUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const target = new URL(devServerUrl);
  const client = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = client(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req.headers, target.host),
    },
    (upstreamRes) => {
      const contentType = String(upstreamRes.headers["content-type"] ?? "");
      const status = upstreamRes.statusCode ?? 200;
      if (status === 200 && contentType.includes("text/html")) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        upstreamRes.on("end", () => {
          const html = injectBrowserBridgeScript(
            Buffer.concat(chunks).toString("utf8"),
          );
          const body = Buffer.from(html);
          const headers = { ...upstreamRes.headers };
          delete headers["content-length"];
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          headers["content-length"] = String(body.length);
          headers["cache-control"] = "no-store";
          res.writeHead(status, headers);
          res.end(body);
        });
        return;
      }
      const location = upstreamRes.headers.location;
      if (typeof location === "string" && location.startsWith(target.origin)) {
        upstreamRes.headers.location =
          location.slice(target.origin.length) || "/";
      }
      res.writeHead(status, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dyad renderer is not reachable");
  });
  req.pipe(upstream);
}

function proxyUpgrade(
  devServerUrl: string,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) {
  const target = new URL(devServerUrl);
  if (target.protocol !== "http:") {
    socket.destroy();
    return;
  }
  const upstream = netConnect(Number(target.port || 80), target.hostname);
  const fail = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", fail);
  socket.on("error", () => upstream.destroy());
  upstream.on("connect", () => {
    const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || key.toLowerCase() === "host") continue;
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) lines.push(`${key}: ${item}`);
    }
    lines.push(`host: ${target.host}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Resolves a request path inside the packaged renderer directory, or returns
 * null when the path escapes it. Routes without a file extension fall back to
 * index.html so the renderer's router can take over, like loadFile does.
 */
export function resolveRendererFile(
  rendererDir: string,
  requestPath: string,
): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(requestPath, "http://127.0.0.1").pathname,
    );
  } catch {
    return null;
  }
  const root = path.resolve(rendererDir);
  const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let target = path.resolve(root, `.${path.sep}${normalized}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return null;
  }
  if (target === root || path.extname(target) === "") {
    target = path.join(root, "index.html");
  }
  return target;
}

async function serveRendererFile(
  rendererDir: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const target = resolveRendererFile(rendererDir, req.url ?? "/");
  if (!target) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const extension = path.extname(target).toLowerCase();
  const contentType =
    STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream";
  try {
    if (extension === ".html") {
      const html = injectBrowserBridgeScript(await fs.readFile(target, "utf8"));
      const body = Buffer.from(html);
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": String(body.length),
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    const body = await fs.readFile(target);
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": String(body.length),
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export type BrowserBridgeOptions = {
  port?: number;
  host?: string;
} & (
  | { devServerUrl: string; rendererDir?: undefined }
  | { rendererDir: string; devServerUrl?: undefined }
);

export function startBrowserBridge(
  options: BrowserBridgeOptions,
): Promise<BrowserBridge> {
  const devServerUrl = options.devServerUrl;
  const rendererDir = options.rendererDir;
  const host = options.host ?? BROWSER_BRIDGE_HOST;
  const port = options.port ?? BROWSER_BRIDGE_PORT;
  const sockets = new Set<WebSocket>();
  const push = (event: BrowserBridgePush) => {
    const message: BridgeSocketMessage = {
      type: "event",
      channel: event.channel,
      args: event.args,
    };
    for (const socket of sockets) sendSocketMessage(socket, message);
  };
  const socketServer = new WebSocketServer({ noServer: true });
  const server: Server = createServer((req, res) => {
    if (devServerUrl) {
      proxyHttp(devServerUrl, req, res);
    } else if (rendererDir) {
      void serveRendererFile(rendererDir, req, res);
    }
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === BROWSER_BRIDGE_SOCKET_PATH) {
      socketServer.handleUpgrade(req, socket, head, (webSocket) => {
        socketServer.emit("connection", webSocket, req);
      });
      return;
    }
    if (devServerUrl) {
      proxyUpgrade(devServerUrl, req, socket, head);
    } else {
      socket.destroy();
    }
  });
  socketServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("message", (data) => {
      void handleSocketMessage(data, push).then((response) => {
        if (response) sendSocketMessage(socket, response);
      });
    });
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Browser bridge did not bind a TCP port"));
        return;
      }
      const bridge: BrowserBridge = {
        port: address.port,
        host: address.address,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            for (const socket of sockets) socket.close();
            socketServer.close();
            server.close((error) => {
              if (error) closeReject(error);
              else closeResolve();
            });
          }),
      };
      logger.info(
        `Browser bridge listening on http://${bridge.host}:${bridge.port}`,
      );
      resolve(bridge);
    });
  });
}

function readViteDevServerUrl(): string | undefined {
  try {
    const value = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

function bridgePortFromEnv(): number {
  const raw = process.env.DYAD_BROWSER_BRIDGE_PORT;
  if (!raw) return BROWSER_BRIDGE_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return BROWSER_BRIDGE_PORT;
  }
  return port;
}

/**
 * The packaged renderer lives next to the main bundle, the same path
 * main.ts hands to loadFile.
 */
function packagedRendererDir(): string {
  return path.join(__dirname, "../renderer/main_window");
}

export function startBrowserBridgeFromEnv(): void {
  if (process.env.DYAD_BROWSER_BRIDGE !== "1") return;
  const devServerUrl = readViteDevServerUrl();
  const port = bridgePortFromEnv();
  void (
    devServerUrl
      ? startBrowserBridge({ devServerUrl, port })
      : startBrowserBridge({ rendererDir: packagedRendererDir(), port })
  )
    .then((bridge) => {
      activeBridge = bridge;
    })
    .catch((error) => {
      logger.error("Failed to start browser bridge", error);
    });
}

export function stopBrowserBridge(): void {
  const bridge = activeBridge;
  activeBridge = null;
  if (!bridge) return;
  void bridge.close().catch((error) => {
    logger.error("Failed to stop browser bridge", error);
  });
}
