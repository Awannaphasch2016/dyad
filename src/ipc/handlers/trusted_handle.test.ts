// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureTrustedRenderer } from "../utils/renderer_security";

const mocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
  >(),
  listeners: new Map<
    string,
    Array<(event: unknown, ...args: unknown[]) => Promise<unknown> | unknown>
  >(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (
          event: unknown,
          ...args: unknown[]
        ) => Promise<unknown> | unknown,
      ) => mocks.handlers.set(channel, handler),
    ),
    on: vi.fn(
      (
        channel: string,
        handler: (
          event: unknown,
          ...args: unknown[]
        ) => Promise<unknown> | unknown,
      ) => {
        const listeners = mocks.listeners.get(channel) ?? [];
        listeners.push(handler);
        mocks.listeners.set(channel, listeners);
      },
    ),
  },
}));

const {
  getTrustedIpcHandler,
  getTrustedIpcSendHandler,
  registerTrustedIpcHandler,
  registerTrustedIpcSend,
} = await import("./trusted_handle");

function eventFor(url: string) {
  const frame = { url };
  return { sender: { mainFrame: frame }, senderFrame: frame };
}

function listProductionTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "testing", "fixtures"].includes(entry.name)) {
        return [];
      }
      return listProductionTypeScriptFiles(entryPath);
    }
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [entryPath];
  });
}

describe("registerTrustedIpcHandler", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.listeners.clear();
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
  });

  it("runs handlers for the trusted renderer", async () => {
    const implementation = vi.fn(async (_event, value: number) => value * 2);
    registerTrustedIpcHandler("trusted", implementation);

    await expect(
      mocks.handlers.get("trusted")?.(
        eventFor("http://localhost:5173/chat"),
        21,
      ),
    ).resolves.toBe(42);
    expect(implementation).toHaveBeenCalledOnce();
  });

  it("rejects untrusted renderers before running the handler", async () => {
    const implementation = vi.fn();
    registerTrustedIpcHandler("untrusted", implementation);

    await expect(
      mocks.handlers.get("untrusted")?.(eventFor("https://attacker.example/")),
    ).rejects.toThrow("trusted Dyad renderer");
    expect(implementation).not.toHaveBeenCalled();
  });

  it("lets envelope-based handlers map trust failures", async () => {
    const implementation = vi.fn();
    const mapTrustFailure = vi.fn((error: unknown) => ({ error }));
    registerTrustedIpcHandler("mapped", implementation, {
      onTrustFailure: mapTrustFailure,
    });

    const result = await mocks.handlers.get("mapped")?.(
      eventFor("https://attacker.example/"),
    );

    expect(result).toEqual({ error: expect.any(Error) });
    expect(mapTrustFailure).toHaveBeenCalledOnce();
    expect(implementation).not.toHaveBeenCalled();
  });

  it("keeps a handler the browser bridge can call without the trust check", async () => {
    const implementation = vi.fn(async () => "ok");
    registerTrustedIpcHandler("browser-bridge", implementation);

    await expect(
      getTrustedIpcHandler("browser-bridge")?.(
        eventFor("https://attacker.example/") as never,
      ),
    ).resolves.toBe("ok");
    expect(implementation).toHaveBeenCalledOnce();
    await expect(
      mocks.handlers.get("browser-bridge")?.(
        eventFor("https://attacker.example/"),
      ),
    ).rejects.toThrow("trusted Dyad renderer");
  });

  it("is the only production entry point for ipcMain invoke handlers", () => {
    const sourceRoot = path.join(process.cwd(), "src");
    const facadePath = path.join(
      sourceRoot,
      "ipc",
      "handlers",
      "trusted_handle.ts",
    );
    const directRegistrations = listProductionTypeScriptFiles(sourceRoot)
      .filter((filePath) => filePath !== facadePath)
      .filter((filePath) =>
        /\bipcMain\s*(?:\?\.|\.)\s*handle(?:Once)?\s*\(/.test(
          fs.readFileSync(filePath, "utf8"),
        ),
      )
      .map((filePath) => path.relative(process.cwd(), filePath));

    expect(directRegistrations).toEqual([]);
  });
});

describe("registerTrustedIpcSend", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.listeners.clear();
    configureTrustedRenderer({
      devServerUrl: "http://localhost:5173",
      packagedRendererUrl: "file:///app/renderer/main_window/index.html",
    });
  });

  it("runs send handlers for the trusted renderer", () => {
    const implementation = vi.fn();
    registerTrustedIpcSend("send-trusted", implementation);

    mocks.listeners.get("send-trusted")?.[0]?.(
      eventFor("http://localhost:5173/chat"),
      { operationId: "create-1" },
    );

    expect(implementation).toHaveBeenCalledOnce();
  });

  it("drops an untrusted send before the handler", () => {
    const implementation = vi.fn();
    const onTrustFailure = vi.fn();
    registerTrustedIpcSend("send-untrusted", implementation, {
      onTrustFailure,
    });

    mocks.listeners.get("send-untrusted")?.[0]?.(
      eventFor("https://attacker.example/"),
      { operationId: "create-1" },
    );

    expect(implementation).not.toHaveBeenCalled();
    expect(onTrustFailure).toHaveBeenCalledOnce();
  });

  it("keeps a send handler the browser bridge can call without the trust check", () => {
    const implementation = vi.fn();
    registerTrustedIpcSend("send-bridge", implementation);

    getTrustedIpcSendHandler("send-bridge")?.(
      eventFor("https://attacker.example/") as never,
      { operationId: "create-1" },
    );

    expect(implementation).toHaveBeenCalledOnce();
    mocks.listeners.get("send-bridge")?.[0]?.(
      eventFor("https://attacker.example/"),
    );
    expect(implementation).toHaveBeenCalledOnce();
  });
});
