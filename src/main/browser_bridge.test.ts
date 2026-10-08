// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

import {
  rememberSessionToken,
  sessionTokenFor,
  clearSessionTokensForTesting,
  WEB_BRIDGE_SENDER_ID,
} from "@/control_plane/session_store";
import { registerClerkHandlers } from "@/ipc/handlers/clerk_handlers";
import {
  clearTrustedIpcHandlersForTesting,
  registerTrustedIpcHandler,
} from "@/ipc/handlers/trusted_handle";
import { FirstPromptCreationRegistry } from "@/ipc/services/first_prompt_creation_service";
import {
  BROWSER_BRIDGE_SOCKET_PATH,
  bridgeHostFromEnv,
  browserBridgeClientScript,
  browserBridgeInvokeArgs,
  dispatchBrowserInvoke,
  dispatchBrowserSend,
  injectBrowserBridgeScript,
  resolveRendererFile,
  startBrowserBridge,
  type BrowserBridge,
} from "./browser_bridge";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  clearTrustedIpcHandlersForTesting();
  clearSessionTokensForTesting();
  const pending = closers.splice(0);
  for (const close of pending) await close();
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not bind"));
        return;
      }
      resolve(address.port);
    });
  });
}

function openBridgeSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}${BROWSER_BRIDGE_SOCKET_PATH}`,
  );
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function invokeOnSocket(socket: WebSocket, id: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: { toString(): string }) => {
      const message = JSON.parse(data.toString()) as {
        id?: number;
        type?: string;
        result?: unknown;
        message?: string;
      };
      if (message.id !== id) return;
      socket.off("message", onMessage);
      if (message.type === "error") {
        reject(new Error(message.message ?? "IPC failed"));
        return;
      }
      resolve(message.result);
    };
    socket.on("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        type: "invoke",
        channel: "get-user-settings",
        args: [],
      }),
    );
  });
}

async function waitForSocketClose(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.CLOSED) {
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
}

async function startSocketBridge(): Promise<BrowserBridge> {
  const rendererDir = await mkdtemp(path.join(tmpdir(), "dyad-bridge-"));
  closers.push(() => rm(rendererDir, { recursive: true, force: true }));
  const bridge = await startBrowserBridge({ rendererDir, port: 0 });
  closers.push(() => bridge.close());
  return bridge;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error("timed out waiting for the browser bridge");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("browser bridge", () => {
  it("marks only the Safari session-token call as a bridge call", () => {
    expect(
      browserBridgeInvokeArgs("clerk:set-session-token", [
        { token: "ipad-token" },
      ]),
    ).toEqual([{ token: "ipad-token", bridge: true }]);
    expect(browserBridgeInvokeArgs("get-user-settings", [])).toEqual([]);
  });

  it("injects window.electron ahead of the renderer", () => {
    const script = browserBridgeClientScript();
    expect(script).toContain("window.electron");
    expect(script).toContain("clerk:set-session-token");
    expect(script).toContain("bridge: true");
    const html = injectBrowserBridgeScript(
      "<head><title>wewebplus</title></head>",
    );
    expect(html.startsWith("<head><script")).toBe(true);
    expect(html).not.toContain("<base ");
    const nested = injectBrowserBridgeScript(
      '<head><script type="module" src="./assets/index.js"></script></head>',
    );
    expect(nested).toContain('src="/assets/index.js"');
    expect(html.indexOf("window.electron")).toBeLessThan(
      html.indexOf("<title>"),
    );
    expect(injectBrowserBridgeScript(html)).toBe(html);

    const sent: string[] = [];
    const sandbox = {
      window: {} as {
        electron?: {
          ipcRenderer: {
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
          };
        };
      },
      location: { protocol: "http:", host: "127.0.0.1:8372" },
      WebSocket: class {
        readyState = 1;
        addEventListener(type: string, listener: () => void) {
          if (type === "open") listener();
        }
        send(payload: string) {
          sent.push(payload);
        }
      },
      console,
      setTimeout,
      Map,
      Set,
      Promise,
      JSON,
      Error,
      Array,
      Object,
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    expect(() =>
      sandbox.window.electron?.ipcRenderer.invoke("not-a-channel"),
    ).toThrow("Invalid channel: not-a-channel");
    void sandbox.window.electron?.ipcRenderer.invoke(
      "clerk:set-session-token",
      { token: "ipad-token" },
    );
    expect(sent.some((payload) => payload.includes('"bridge":true'))).toBe(
      true,
    );
    void sandbox.window.electron?.ipcRenderer.invoke(
      "get-user-settings",
      undefined,
    );
    const last = JSON.parse(sent[sent.length - 1]) as { args: unknown[] };
    expect(last.args).toEqual([]);
  });

  it("returns a handler result and pushes sender.send to the listener", async () => {
    registerTrustedIpcHandler("get-user-settings", async (event) => {
      event.sender.send("app:list-updated", { from: "bridge" });
      return { ok: true };
    });
    const pushed: Array<{ channel: string; args: unknown[] }> = [];
    await expect(
      dispatchBrowserInvoke("get-user-settings", [], (event) => {
        pushed.push(event);
      }),
    ).resolves.toEqual({ ok: true });
    expect(pushed).toEqual([
      { channel: "app:list-updated", args: [{ from: "bridge" }] },
    ]);
  });

  it("rejects a channel that is not on the preload allowlist", async () => {
    await expect(
      dispatchBrowserInvoke("not-a-channel", [], () => {}),
    ).rejects.toThrow("Invalid channel: not-a-channel");
    expect(() => dispatchBrowserSend("not-a-channel")).toThrow(
      "Invalid channel: not-a-channel",
    );
    expect(() => dispatchBrowserSend("preview-view:set-bounds")).not.toThrow();
  });

  it("stores the Safari session token on the bridge slot", async () => {
    registerClerkHandlers();
    rememberSessionToken(4, "desktop-token");
    await dispatchBrowserInvoke(
      "clerk:set-session-token",
      [{ token: "ipad-token" }],
      () => {},
    );
    expect(sessionTokenFor(WEB_BRIDGE_SENDER_ID)).toBe("ipad-token");
    expect(sessionTokenFor(4)).toBe("desktop-token");
  });

  it("serves the renderer and delivers invoke results over the socket", async () => {
    const vite = createServer((req, res) => {
      if (req.url === "/src/renderer.tsx") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end("console.log(1)");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<head></head><body>dyad</body>");
    });
    const vitePort = await listen(vite);
    closers.push(
      () =>
        new Promise((resolve, reject) => {
          vite.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const bridge: BrowserBridge = await startBrowserBridge({
      devServerUrl: `http://127.0.0.1:${vitePort}`,
      port: 0,
    });
    closers.push(() => bridge.close());
    expect(bridge.host).toBe("127.0.0.1");

    const page = await fetch(`http://127.0.0.1:${bridge.port}/`);
    const html = await page.text();
    expect(html).toContain("window.electron");
    expect(html).toContain("<body>dyad</body>");
    const script = await fetch(
      `http://127.0.0.1:${bridge.port}/src/renderer.tsx`,
    );
    expect(await script.text()).toBe("console.log(1)");

    registerTrustedIpcHandler("get-user-settings", async (event) => {
      event.sender.send("app:list-updated", { from: "bridge" });
      return { ok: true };
    });
    const received: unknown[] = [];
    const socket = new WebSocket(
      `ws://127.0.0.1:${bridge.port}${BROWSER_BRIDGE_SOCKET_PATH}`,
    );
    closers.push(async () => {
      socket.close();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.on("message", (data) => {
      received.push(JSON.parse(data.toString()));
    });
    socket.send(
      JSON.stringify({
        id: 1,
        type: "invoke",
        channel: "get-user-settings",
        args: [],
      }),
    );
    socket.send(
      JSON.stringify({
        id: 2,
        type: "invoke",
        channel: "not-a-channel",
        args: [],
      }),
    );
    await waitFor(
      () =>
        received.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            (message as { id?: number }).id === 1,
        ) &&
        received.some(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            (message as { id?: number }).id === 2,
        ),
    );
    expect(received).toContainEqual({
      type: "event",
      channel: "app:list-updated",
      args: [{ from: "bridge" }],
    });
    expect(received).toContainEqual({
      id: 1,
      type: "result",
      result: { ok: true },
    });
    expect(received).toContainEqual({
      id: 2,
      type: "error",
      message: "Invalid channel: not-a-channel",
    });
  });

  it("keeps packaged renderer requests inside the renderer directory", () => {
    const root = path.resolve("/opt/dyad/renderer/main_window");
    expect(resolveRendererFile(root, "/")).toBe(path.join(root, "index.html"));
    expect(resolveRendererFile(root, "/apps/12?tab=chat")).toBe(
      path.join(root, "index.html"),
    );
    expect(resolveRendererFile(root, "/assets/index-abc.js")).toBe(
      path.join(root, "assets", "index-abc.js"),
    );
    expect(resolveRendererFile(root, "/../../etc/passwd")).toBe(
      path.join(root, "index.html"),
    );
    expect(resolveRendererFile(root, "/../../etc/passwd.js")).toBe(
      path.join(root, "etc", "passwd.js"),
    );
    expect(resolveRendererFile(root, "/assets/%2e%2e/%2e%2e/secret.js")).toBe(
      path.join(root, "secret.js"),
    );
    expect(resolveRendererFile(root, "/%zz")).toBeNull();
  });

  it("serves the packaged renderer when there is no Vite dev server", async () => {
    const rendererDir = await mkdtemp(path.join(tmpdir(), "dyad-renderer-"));
    closers.push(() => rm(rendererDir, { recursive: true, force: true }));
    await mkdir(path.join(rendererDir, "assets"));
    await writeFile(
      path.join(rendererDir, "index.html"),
      '<!doctype html><html><head><title>wewebplus</title></head><body><script src="./assets/app.js"></script></body></html>',
    );
    await writeFile(
      path.join(rendererDir, "assets", "app.js"),
      "console.log('packaged renderer');",
    );

    const bridge: BrowserBridge = await startBrowserBridge({
      rendererDir,
      port: 0,
    });
    closers.push(() => bridge.close());
    const origin = `http://${bridge.host}:${bridge.port}`;

    const home = await fetch(`${origin}/`);
    const homeHtml = await home.text();
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(homeHtml).toContain("data-dyad-browser-bridge");
    expect(homeHtml).toContain("<title>wewebplus</title>");

    const route = await fetch(`${origin}/apps/12`);
    const routeHtml = await route.text();
    expect(routeHtml).toContain("data-dyad-browser-bridge");
    expect(routeHtml).toContain('src="/assets/app.js"');
    expect(routeHtml).not.toContain("<base ");

    const asset = await fetch(`${origin}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(await asset.text()).toBe("console.log('packaged renderer');");

    const missing = await fetch(`${origin}/assets/missing.js`);
    expect(missing.status).toBe(404);

    const socket = new WebSocket(
      `ws://${bridge.host}:${bridge.port}${BROWSER_BRIDGE_SOCKET_PATH}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.close();
  });

  it("lets first-prompt tracking register once on the bridge sender", async () => {
    const registry = new FirstPromptCreationRegistry();
    registerTrustedIpcHandler("get-user-settings", async (event) => {
      registry.track("create-1", event.sender);
      return { tracked: true };
    });
    await expect(
      dispatchBrowserInvoke("get-user-settings", [], () => {}),
    ).resolves.toEqual({ tracked: true });
    registry.commit("create-1");
  });

  it("cancels a first-prompt create when the last browser socket closes", async () => {
    const bridge = await startSocketBridge();
    const registry = new FirstPromptCreationRegistry();
    let destroyed = false;
    registerTrustedIpcHandler("get-user-settings", async (event) => {
      registry.track("create-1", event.sender);
      destroyed = event.sender.isDestroyed();
      return { ok: true };
    });
    const socket = await openBridgeSocket(bridge.port);
    await invokeOnSocket(socket, 1);
    expect(destroyed).toBe(false);
    socket.close();
    await waitForSocketClose(socket);
    const cleanup = vi.fn(async () => {});
    await registry.complete("create-1", cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps a first-prompt create running while another browser socket is open", async () => {
    const bridge = await startSocketBridge();
    const registry = new FirstPromptCreationRegistry();
    const senders: object[] = [];
    registerTrustedIpcHandler("get-user-settings", async (event) => {
      senders.push(event.sender);
      if (senders.length === 1) registry.track("create-1", event.sender);
      return { open: !event.sender.isDestroyed() };
    });
    const first = await openBridgeSocket(bridge.port);
    const second = await openBridgeSocket(bridge.port);
    closers.push(async () => {
      first.close();
      second.close();
    });
    await invokeOnSocket(first, 1);
    first.close();
    await waitForSocketClose(first);
    await expect(invokeOnSocket(second, 2)).resolves.toEqual({ open: true });
    expect(senders[0]).toBe(senders[1]);
    const cleanup = vi.fn(async () => {});
    await registry.complete("create-1", cleanup);
    expect(cleanup).not.toHaveBeenCalled();
  });
});

describe("browser bridge host", () => {
  it("stays on loopback unless the formula task asks for every interface", () => {
    expect(bridgeHostFromEnv(undefined)).toBe("127.0.0.1");
    expect(bridgeHostFromEnv("")).toBe("127.0.0.1");
    expect(bridgeHostFromEnv("0.0.0.0")).toBe("0.0.0.0");
    expect(bridgeHostFromEnv("127.0.0.1")).toBe("127.0.0.1");
    expect(bridgeHostFromEnv("10.0.0.8")).toBe("127.0.0.1");
    expect(bridgeHostFromEnv("localhost")).toBe("127.0.0.1");
  });

  it("binds the host passed to the bridge", async () => {
    const rendererDir = await mkdtemp(path.join(tmpdir(), "dyad-bridge-host-"));
    closers.push(() => rm(rendererDir, { recursive: true, force: true }));
    const bridge = await startBrowserBridge({
      rendererDir,
      port: 0,
      host: "0.0.0.0",
    });
    closers.push(() => bridge.close());
    expect(bridge.host).toBe("0.0.0.0");
  });
});
