import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { apps, chats, chatTurnIntents, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import {
  createFactoryHostBridgeServer,
  resolveFactoryHostBridgeHost,
  startFactoryHostBridgeFromEnv,
  stopFactoryHostBridge,
} from "./factory_host_bridge_server";
import type { SerializableChatTurnIntent } from "@/chat_stream/transport";

describe("factory host bridge", () => {
  let database: TestDb;
  let appId: number;
  let baseUrl: string;
  let server: ReturnType<typeof createFactoryHostBridgeServer>;
  let dispatchedIntents: SerializableChatTurnIntent[];

  beforeEach(async () => {
    database = createInMemoryTestDb();
    dispatchedIntents = [];
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
      dispatchChatIntent: async (intent) => {
        dispatchedIntents.push(intent);
        const existing = database
          .select()
          .from(chatTurnIntents)
          .where(eq(chatTurnIntents.intentId, intent.intentId))
          .get();
        if (existing) return "accepted";
        const acceptedMessageId = Number(
          database
            .insert(messages)
            .values({
              chatId: intent.chatId,
              role: "user",
              content: intent.prompt,
              chatTurnIntentId: intent.intentId,
            })
            .run().lastInsertRowid,
        );
        database
          .insert(messages)
          .values({
            chatId: intent.chatId,
            role: "assistant",
            content: "actor finished",
          })
          .run();
        database
          .insert(chatTurnIntents)
          .values({
            intentId: intent.intentId,
            chatId: intent.chatId,
            payloadHash: intent.payloadHash,
            acceptance: "message-accepted",
            recovery: "terminal",
            terminalOutcome: "completed",
            acceptedMessageId,
          })
          .run();
        return "accepted";
      },
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

  it("submits idempotent runs through the actor dispatcher and polls final state", async () => {
    await request(`/v1/apps/${appId}/link`, {
      method: "PUT",
      body: { gasCityProjectId: "gc-run" },
    });
    const path = `/v1/apps/${appId}/phases/implementation/runs`;
    const first = await request(path, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Build it" },
    });
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({
      status: "completed",
      terminalOutcome: "completed",
      finalResult: { content: "actor finished" },
    });
    expect(dispatchedIntents[0]).toMatchObject({
      appId,
      requestedChatMode: "local-agent",
      prompt: "Build it",
      invocationRef: {
        kind: "chat-stream",
        entityKey: first.body.chatId,
      },
    });
    expect(dispatchedIntents[0]).not.toHaveProperty("owner");
    const runId = first.body.runId as string;

    const replay = await request(path, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Build it" },
    });
    expect(replay.body).toMatchObject({ runId, status: "completed" });

    const polled = await request(`/v1/runs/${runId}`);
    expect(polled.body).toMatchObject({ runId, status: "completed" });

    const conflict = await request(path, {
      method: "POST",
      body: { idempotencyKey: "run-1", prompt: "Different prompt" },
    });
    expect(conflict.status).toBe(409);
  });

  it("provisions one factory-managed preview app", async () => {
    const first = await request("/v1/preview-factory-app", {
      method: "POST",
      body: {},
    });
    const second = await request("/v1/preview-factory-app", {
      method: "POST",
      body: {},
    });
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
    const app = database
      .select()
      .from(apps)
      .where(eq(apps.id, first.body.appId))
      .get();
    expect(app?.factoryHostManaged).toBe(true);
    expect(app?.ownerType).toBe("org");
    const phaseChats = database
      .select()
      .from(chats)
      .where(eq(chats.appId, first.body.appId))
      .all();
    expect(phaseChats.map((chat) => chat.title).sort()).toEqual([
      "Delivery",
      "Discovery",
      "Implementation",
    ]);
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
