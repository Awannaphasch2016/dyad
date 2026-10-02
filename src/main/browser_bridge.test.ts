// @vitest-environment node

import { createServer, type Server } from "node:http";
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
import {
  BROWSER_BRIDGE_SOCKET_PATH,
  browserBridgeClientScript,
  browserBridgeInvokeArgs,
  dispatchBrowserInvoke,
  dispatchBrowserSend,
  injectBrowserBridgeScript,
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
});
