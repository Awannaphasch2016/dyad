import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { DEFAULT_SETTINGS } from "@/main/settings";
import {
  createFactoryHostBridgeServer,
  resolveFactoryHostBridgeHost,
  startFactoryHostBridgeFromEnv,
  stopFactoryHostBridge,
} from "./factory_host_bridge_server";

describe("factory host bridge", () => {
  let database: TestDb;
  let appId: number;
  let baseUrl: string;
  let server: ReturnType<typeof createFactoryHostBridgeServer>;
  beforeEach(async () => {
    database = createInMemoryTestDb();
    appId = Number(
      database.insert(apps).values({ name: "Factory", path: "factory" }).run()
        .lastInsertRowid,
    );
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    server = createFactoryHostBridgeServer({
      token: "correct-secret",
      database,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.$client.close();
  });

  const request = (
    path: string,
    init: {
      method?: string;
      body?: unknown;
      origin?: string;
    } = {},
    token = "correct-secret",
  ) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const body =
        init.body === undefined ? undefined : JSON.stringify(init.body);
      const request = httpRequest(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
          ...(init.origin ? { origin: init.origin } : {}),
          authorization: `Bearer ${token}`,
        },
      });
      request.on("error", reject);
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      });
      if (body !== undefined) request.write(body);
      request.end();
    });

  it("requires bearer auth and rejects browser origins", async () => {
    expect(
      (await request(`/v1/apps/${appId}/factory-state`, {}, "wrong")).status,
    ).toBe(401);
    expect(
      (
        await request(`/v1/apps/${appId}/factory-state`, {
          origin: "http://example.test",
        })
      ).status,
    ).toBe(403);
  });

  it("links an app, resolves chats, stores approvals, and inserts idempotently", async () => {
    const linked = await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-123" },
    });
    expect(linked.body).toMatchObject({
      factoryHostManaged: true,
      gasCityProjectId: "gc-123",
    });

    const phaseResponse = await request(`/v1/apps/${appId}/phases`);
    expect(phaseResponse.body).toEqual({
      discovery: expect.any(Number),
      implementation: expect.any(Number),
      delivery: expect.any(Number),
    });

    const messagePath = `/v1/apps/${appId}/phases/discovery/messages`;
    const first = await request(messagePath, {
      method: "POST",
      body: {
        idempotencyKey: "event-1",
        role: "system",
        content: "Discovery is ready <now>",
      },
    });
    const firstBody = first.body;
    expect(firstBody).toMatchObject({
      inserted: true,
      requestedRole: "system",
      storedRole: "assistant",
    });
    const replay = await request(messagePath, {
      method: "POST",
      body: {
        idempotencyKey: "event-1",
        role: "system",
        content: "different replay",
      },
    });
    expect(replay.body).toMatchObject({
      inserted: false,
      messageId: firstBody.messageId,
    });
    const stored = database.select().from(messages).all();
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toContain("Discovery is ready &lt;now&gt;");

    await request(`/v1/apps/${appId}/phases/discovery/approve`, {
      method: "POST",
    });
    await request(`/v1/apps/${appId}/phases/discovery/approve`, {
      method: "POST",
    });
    const state = await request(`/v1/apps/${appId}/factory-state`);
    expect(state.body).toMatchObject({
      approvedPhases: ["discovery"],
    });
  });

  it("records an orchestrated run without starting the local agent", async () => {
    await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-run" },
    });
    const runPath = `/v1/apps/${appId}/phases/implementation/runs`;
    const first = await request(runPath, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Build it" },
    });
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({
      status: "running",
      terminalOutcome: null,
      finalResult: null,
      gasCityTaskId: first.body.runId,
      eventCursor: 0,
    });
    const runId = first.body.runId as string;
    expect(
      database
        .select()
        .from(messages)
        .all()
        .map((row) => row.content),
    ).toEqual(["Build it", ""]);

    const replay = await request(runPath, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Build it" },
    });
    expect(replay.body).toMatchObject({ runId, status: "running" });
    expect(database.select().from(messages).all()).toHaveLength(2);

    const polled = await request(`/v1/runs/${runId}`);
    expect(polled.body).toMatchObject({ runId, status: "running" });

    const conflict = await request(runPath, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Different prompt" },
    });
    expect(conflict.status).toBe(409);
  });

  it("runs an allowlisted tool through the wrapper and rejects the sandbox", async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-tool-"));
    fs.writeFileSync(path.join(appDir, "note.txt"), "from-disk");
    database
      .update(apps)
      .set({ path: appDir, factoryHostManaged: true })
      .where(eq(apps.id, appId))
      .run();
    const opened = await request(
      `/v1/apps/${appId}/phases/implementation/runs`,
      {
        method: "POST",
        body: { idempotencyKey: "tool-run", prompt: "Read the note" },
      },
    );
    const taskId = opened.body.runId as string;
    const read = await request(`/v1/apps/${appId}/tools/read_file`, {
      method: "POST",
      body: {
        taskId,
        idempotencyKey: "read-1",
        args: { path: "note.txt" },
      },
    });
    expect(read.status).toBe(200);
    expect(read.body.result).toContain("from-disk");

    fs.writeFileSync(path.join(appDir, "note.txt"), "changed");
    const replay = await request(`/v1/apps/${appId}/tools/read_file`, {
      method: "POST",
      body: {
        taskId,
        idempotencyKey: "read-1",
        args: { path: "note.txt" },
      },
    });
    expect(replay.body.result).toContain("from-disk");
    expect(replay.body.result).not.toContain("changed");

    const rejected = await request(
      `/v1/apps/${appId}/tools/execute_sandbox_script`,
      {
        method: "POST",
        body: { taskId, idempotencyKey: "sandbox", args: {} },
      },
    );
    expect(rejected.status).toBe(403);
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it("does not write a file when consent is not already granted", async () => {
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-consent-"));
    const target = path.join(appDir, "keep.txt");
    fs.writeFileSync(target, "original");
    database
      .update(apps)
      .set({ path: appDir, factoryHostManaged: true })
      .where(eq(apps.id, appId))
      .run();
    const opened = await request(
      `/v1/apps/${appId}/phases/implementation/runs`,
      {
        method: "POST",
        body: { idempotencyKey: "consent-run", prompt: "Edit" },
      },
    );
    const settings = vi
      .spyOn(await import("@/main/settings"), "readSettings")
      .mockReturnValue({
        ...DEFAULT_SETTINGS,
        agentToolConsents: { write_file: "ask" },
      });
    try {
      const denied = await request(`/v1/apps/${appId}/tools/write_file`, {
        method: "POST",
        body: {
          taskId: opened.body.runId,
          idempotencyKey: "write-1",
          args: { path: "keep.txt", content: "replaced" },
        },
      });
      expect(denied.status).toBe(409);
      expect(fs.readFileSync(target, "utf8")).toBe("original");
    } finally {
      settings.mockRestore();
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it("replays an event cursor without duplicating the transcript and cancels the task", async () => {
    await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-events" },
    });
    const opened = await request(`/v1/apps/${appId}/phases/discovery/runs`, {
      method: "POST",
      body: { idempotencyKey: "event-run", prompt: "Discover" },
    });
    const taskId = opened.body.runId as string;
    const eventPath = `/v1/apps/${appId}/phases/discovery/events`;
    const first = await request(eventPath, {
      method: "POST",
      body: { taskId, cursor: 1, type: "text", content: "Hello" },
    });
    expect(first.body).toMatchObject({
      appended: true,
      eventCursor: 1,
      status: "running",
    });
    const replay = await request(eventPath, {
      method: "POST",
      body: { taskId, cursor: 1, type: "text", content: "Hello again" },
    });
    expect(replay.body).toMatchObject({ appended: false, eventCursor: 1 });
    const gap = await request(eventPath, {
      method: "POST",
      body: { taskId, cursor: 3, type: "text", content: "skipped" },
    });
    expect(gap.status).toBe(409);
    const assistant = database
      .select()
      .from(messages)
      .all()
      .find((row) => row.role === "assistant");
    expect(assistant?.content).toBe("Hello");

    const cancelled = await request(`/v1/runs/${taskId}/cancel`, {
      method: "POST",
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: "cancelled",
      terminalOutcome: "cancelled",
    });
  });
});

describe("factory host bridge bind address", () => {
  const previous = {
    enabled: process.env.GAS_CITY_HOST_BRIDGE_ENABLED,
    token: process.env.GAS_CITY_HOST_BRIDGE_TOKEN,
    port: process.env.GAS_CITY_HOST_BRIDGE_PORT,
    host: process.env.GAS_CITY_HOST_BRIDGE_HOST,
  };

  afterEach(() => {
    stopFactoryHostBridge();
    for (const [key, value] of Object.entries({
      GAS_CITY_HOST_BRIDGE_ENABLED: previous.enabled,
      GAS_CITY_HOST_BRIDGE_TOKEN: previous.token,
      GAS_CITY_HOST_BRIDGE_PORT: previous.port,
      GAS_CITY_HOST_BRIDGE_HOST: previous.host,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults to loopback and rejects hostnames", () => {
    expect(resolveFactoryHostBridgeHost({})).toBe("127.0.0.1");
    expect(
      resolveFactoryHostBridgeHost({ GAS_CITY_HOST_BRIDGE_HOST: " 0.0.0.0 " }),
    ).toBe("0.0.0.0");
    expect(() =>
      resolveFactoryHostBridgeHost({ GAS_CITY_HOST_BRIDGE_HOST: "dyad" }),
    ).toThrow(/IP address/);
    expect(() =>
      resolveFactoryHostBridgeHost({ GAS_CITY_HOST_BRIDGE_HOST: "" }),
    ).toThrow(/IP address/);
  });

  it("accepts a local connection when bound to 0.0.0.0", async () => {
    const server = createFactoryHostBridgeServer({ token: "proof-token" });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => resolve());
    });
    const address = server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `http://127.0.0.1:${address.port}/v1/apps/1/factory-state`,
      );
      request.on("error", reject);
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.end();
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(address.address).toBe("0.0.0.0");
    expect(status).toBe(401);
  });

  it("serves loopback when the host variable is unset", async () => {
    process.env.GAS_CITY_HOST_BRIDGE_ENABLED = "true";
    process.env.GAS_CITY_HOST_BRIDGE_TOKEN = "proof-token";
    delete process.env.GAS_CITY_HOST_BRIDGE_HOST;
    const probe = createNetServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    process.env.GAS_CITY_HOST_BRIDGE_PORT = String(port);
    await startFactoryHostBridgeFromEnv();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        `http://127.0.0.1:${port}/v1/apps/1/factory-state`,
      );
      request.on("error", reject);
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.end();
    });
    expect(status).toBe(401);
  });
});
