import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { eq } from "drizzle-orm";
import { apps, chats, chatTurnIntents, messages } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { createFactoryHostBridgeServer } from "./factory_host_bridge_server";
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
});
