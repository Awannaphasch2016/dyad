import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  apps,
  chats,
  chatTurnIntents,
  factoryHostRuns,
  hitlQuestions,
  messages,
} from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import { openFactoryRequestForRun } from "./factory_host_request";

const REQUEST = `## Request for project-manager

Which name should the page use?`;

const SUMMARY = `## Implementation summary

- The page lists the lunch menu.`;

describe("openFactoryRequestForRun", () => {
  it("stores one question from a completed run and ignores a second pass", () => {
    const database = createInMemoryTestDb();
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: "factory" }).run()
        .lastInsertRowid,
    );
    database
      .update(apps)
      .set({ ownerType: "org", ownerId: "org_wewebplus" })
      .where(eq(apps.id, appId))
      .run();
    const chatId = Number(
      database.insert(chats).values({ appId, title: "Implementation" }).run()
        .lastInsertRowid,
    );
    const userId = Number(
      database
        .insert(messages)
        .values({ chatId, role: "user", content: "Build the page" })
        .run().lastInsertRowid,
    );
    database
      .insert(messages)
      .values({ chatId, role: "assistant", content: REQUEST })
      .run();
    const runId = "gas-city-run:a6";
    database
      .insert(chatTurnIntents)
      .values({
        intentId: runId,
        chatId,
        payloadHash: "hash",
        acceptance: "message-accepted",
        recovery: "terminal",
        terminalOutcome: "completed",
        acceptedMessageId: userId,
      })
      .run();
    database
      .insert(factoryHostRuns)
      .values({
        runId,
        appId,
        chatId,
        phase: "implementation",
        idempotencyKey: "a6-unit",
        promptHash: "hash",
        intentId: runId,
        acceptance: "accepted",
      })
      .run();

    const opened = openFactoryRequestForRun(database, runId);
    expect(opened?.stop).toBe("human-required");
    const again = openFactoryRequestForRun(database, runId);
    expect(again?.questionId).toBe(opened?.questionId);
    const stored = database.select().from(hitlQuestions).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.targetRoleId).toBe("project-manager");
    expect(stored[0]?.beadId).toBeNull();
    expect(stored[0]?.body).toContain("Which name should the page use?");
    database.$client.close();
  });

  it("classifies a phase summary as ready for approval and stores no question", () => {
    const database = createInMemoryTestDb();
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: "factory" }).run()
        .lastInsertRowid,
    );
    database
      .update(apps)
      .set({ ownerType: "org", ownerId: "org_wewebplus" })
      .where(eq(apps.id, appId))
      .run();
    const chatId = Number(
      database.insert(chats).values({ appId, title: "Implementation" }).run()
        .lastInsertRowid,
    );
    const opened = openFactoryRequestForRun(database, "missing-run", SUMMARY);
    expect(opened).toBeNull();

    const runId = "gas-city-run:summary";
    database
      .insert(factoryHostRuns)
      .values({
        runId,
        appId,
        chatId,
        phase: "implementation",
        idempotencyKey: "a6-summary",
        promptHash: "hash",
        intentId: runId,
        acceptance: "accepted",
      })
      .run();
    const summary = openFactoryRequestForRun(database, runId, SUMMARY);
    expect(summary).toEqual({ stop: "ready-for-approval", questionId: null });
    expect(database.select().from(hitlQuestions).all()).toHaveLength(0);
    database.$client.close();
  });
});
