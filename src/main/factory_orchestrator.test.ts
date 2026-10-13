import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import { linkFactoryApp } from "./factory_host_service";
import {
  isFactoryOrchestratedChat,
  runFactoryOrchestratedTurn,
  applyFactoryTurnEvent,
} from "./factory_orchestrator";

describe("factory orchestrator", () => {
  it("keeps ordinary chat titles off the factory task", () => {
    expect(
      isFactoryOrchestratedChat({ factoryHostManaged: true }, "Discovery"),
    ).toBe(true);
    expect(
      isFactoryOrchestratedChat({ factoryHostManaged: true }, "Notes"),
    ).toBe(false);
    expect(
      isFactoryOrchestratedChat({ factoryHostManaged: false }, "Discovery"),
    ).toBe(false);
  });

  it("streams a factory turn from orchestrator events without a local agent", async () => {
    const database = createInMemoryTestDb();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-turn-"));
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: appDir }).run()
        .lastInsertRowid,
    );
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    linkFactoryApp(database, appId, "gc-turn");
    const chatId = database
      .select()
      .from(chats)
      .all()
      .find((row) => row.title === "Implementation")!.id;
    const sent: string[] = [];
    const outcome = await runFactoryOrchestratedTurn({
      database,
      sender: {
        isDestroyed: () => false,
        send: (channel) => sent.push(channel),
      },
      chatId,
      appId,
      phase: "implementation",
      prompt: "Build the counter",
      abortSignal: new AbortController().signal,
      idempotencyKey: "turn-1",
      notify: async (payload) => {
        const taskId = payload.taskId as string;
        applyFactoryTurnEvent(database, {
          appId,
          phase: "implementation",
          taskId,
          cursor: 1,
          type: "text",
          content: "Working",
        });
        applyFactoryTurnEvent(database, {
          appId,
          phase: "implementation",
          taskId,
          cursor: 2,
          type: "end",
          content: "",
        });
      },
    });
    expect(outcome).toBe("completed");
    const replay = await runFactoryOrchestratedTurn({
      database,
      sender: {
        isDestroyed: () => false,
        send: (channel) => sent.push(channel),
      },
      chatId,
      appId,
      phase: "implementation",
      prompt: "Build the counter",
      abortSignal: new AbortController().signal,
      idempotencyKey: "turn-1",
      notify: async () => {
        throw new Error("completed task should not be sent again");
      },
    });
    expect(replay).toBe("completed");
    expect(sent.at(-1)).toBe("chat:response:end");
    expect(sent).toEqual([
      "chat:response:chunk",
      "chat:response:chunk",
      "chat:response:end",
      "chat:response:end",
    ]);
    expect(
      database
        .select()
        .from(messages)
        .all()
        .map((row) => row.content),
    ).toEqual(["Build the counter", "Working"]);
    database.$client.close();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
