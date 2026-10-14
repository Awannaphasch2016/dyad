import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apps, chats, messages } from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import {
  linkFactoryApp,
  openOrchestratedRun,
  readFactoryState,
} from "./factory_host_service";
import { FACTORY_FORMULA } from "@/lib/factoryFormula";
import {
  isFactoryOrchestratedChat,
  runFactoryOrchestratedTurn,
  applyFactoryTurnEvent,
  submitFactoryGateVerdict,
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
        expect(payload).toMatchObject({
          type: "sling",
          formula: "speckit-phased",
        });
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

  it("keeps the next phase locked until the gate bead closes", () => {
    const database = createInMemoryTestDb();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-bead-"));
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: appDir }).run()
        .lastInsertRowid,
    );
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    linkFactoryApp(database, appId, "gc-bead");
    const opened = openOrchestratedRun(database, {
      appId,
      phase: "discovery",
      prompt: "Build the site",
      idempotencyKey: FACTORY_FORMULA,
      formula: FACTORY_FORMULA,
    });
    applyFactoryTurnEvent(database, {
      appId,
      phase: "discovery",
      taskId: opened.runId,
      cursor: 1,
      type: "input-required",
      content: "Approve these discovery artifacts?",
      stepId: "accept-discovery",
    });
    expect(readFactoryState(database, appId)).toMatchObject({
      formula: "speckit-phased",
      currentStepId: "accept-discovery",
      openPhase: "discovery",
      closedPhases: [],
      gateWaiting: true,
    });
    applyFactoryTurnEvent(database, {
      appId,
      phase: "implementation",
      taskId: opened.runId,
      cursor: 2,
      type: "text",
      content: "Implementing",
      stepId: "implement",
    });
    expect(readFactoryState(database, appId).closedPhases).toEqual([
      "discovery",
    ]);
    database.$client.close();
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it("posts approve for the open gate", async () => {
    const database = createInMemoryTestDb();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-verdict-"));
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: appDir }).run()
        .lastInsertRowid,
    );
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    linkFactoryApp(database, appId, "gc-verdict");
    const opened = openOrchestratedRun(database, {
      appId,
      phase: "discovery",
      prompt: "Build the site",
      idempotencyKey: FACTORY_FORMULA,
      formula: FACTORY_FORMULA,
    });
    applyFactoryTurnEvent(database, {
      appId,
      phase: "discovery",
      taskId: opened.runId,
      cursor: 1,
      type: "input-required",
      content: "Waiting for Discovery approval.",
      stepId: "accept-discovery",
    });
    const previousUrl = process.env.GAS_CITY_ORCHESTRATOR_URL;
    const previousFetch = globalThis.fetch;
    const bodies: unknown[] = [];
    process.env.GAS_CITY_ORCHESTRATOR_URL = "http://127.0.0.1:9/orchestrator";
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const state = await submitFactoryGateVerdict(
        database,
        appId,
        "discovery",
      );
      expect(state.gateWaiting).toBe(true);
      expect(bodies).toEqual([
        {
          type: "verdict",
          taskId: opened.runId,
          stepId: "accept-discovery",
          verdict: "approve",
        },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) {
        delete process.env.GAS_CITY_ORCHESTRATOR_URL;
      } else {
        process.env.GAS_CITY_ORCHESTRATOR_URL = previousUrl;
      }
      database.$client.close();
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });

  it("paints the bead chat and releases the stream at the gate", async () => {
    const database = createInMemoryTestDb();
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-paint-"));
    const appId = Number(
      database.insert(apps).values({ name: "Factory", path: appDir }).run()
        .lastInsertRowid,
    );
    for (const title of ["Discovery", "Implementation", "Delivery"]) {
      database.insert(chats).values({ appId, title }).run();
    }
    linkFactoryApp(database, appId, "gc-paint");
    const phaseChats = Object.fromEntries(
      database
        .select()
        .from(chats)
        .all()
        .map((row) => [row.title, row.id]),
    ) as Record<string, number>;
    const sent: { channel: string; chatId?: number }[] = [];
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let reachedGate: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      reachedGate = resolve;
    });
    const pending = runFactoryOrchestratedTurn({
      database,
      sender: {
        isDestroyed: () => false,
        send: (channel, payload) => {
          const body = payload as { chatId?: number } | undefined;
          sent.push({ channel, chatId: body?.chatId });
        },
      },
      chatId: phaseChats.Discovery,
      appId,
      phase: "discovery",
      prompt: "Build the site",
      abortSignal: new AbortController().signal,
      notify: async (payload) => {
        const taskId = payload.taskId as string;
        applyFactoryTurnEvent(database, {
          appId,
          phase: "discovery",
          taskId,
          cursor: 1,
          type: "text",
          content: "Specify",
          stepId: "requirements",
        });
        applyFactoryTurnEvent(database, {
          appId,
          phase: "discovery",
          taskId,
          cursor: 2,
          type: "activity",
          content: "routing beads",
          stepId: "requirements",
        });
        applyFactoryTurnEvent(database, {
          appId,
          phase: "discovery",
          taskId,
          cursor: 3,
          type: "input-required",
          content: "Approve these discovery artifacts?",
          stepId: "accept-discovery",
        });
        reachedGate();
        await gate;
        applyFactoryTurnEvent(database, {
          appId,
          phase: "implementation",
          taskId,
          cursor: 4,
          type: "text",
          content: "Implementing",
          stepId: "implement",
        });
        applyFactoryTurnEvent(database, {
          appId,
          phase: "delivery",
          taskId,
          cursor: 5,
          type: "end",
          content: "published",
          stepId: "publish",
        });
      },
    });
    await reached;
    expect(sent).toEqual([
      { channel: "chat:response:chunk", chatId: phaseChats.Discovery },
      { channel: "chat:response:end", chatId: phaseChats.Discovery },
    ]);
    expect(readFactoryState(database, appId)).toMatchObject({
      currentStepId: "accept-discovery",
      gateWaiting: true,
      closedPhases: [],
    });
    const duringGate = database
      .select()
      .from(messages)
      .all()
      .map((row) => row.content);
    expect(duringGate).toEqual(["Build the site", "Specify"]);
    releaseGate();
    await expect(pending).resolves.toBe("completed");
    expect(sent).toEqual([
      { channel: "chat:response:chunk", chatId: phaseChats.Discovery },
      { channel: "chat:response:end", chatId: phaseChats.Discovery },
      { channel: "chat:response:chunk", chatId: phaseChats.Implementation },
    ]);
    const byChat = new Map<number, string[]>();
    for (const row of database.select().from(messages).all()) {
      const contents = byChat.get(row.chatId) ?? [];
      contents.push(row.content);
      byChat.set(row.chatId, contents);
    }
    expect(byChat.get(phaseChats.Discovery)).toEqual([
      "Build the site",
      "Specify",
    ]);
    expect(byChat.get(phaseChats.Implementation)).toEqual(["Implementing"]);
    expect(byChat.get(phaseChats.Delivery) ?? []).toEqual([]);
    expect(readFactoryState(database, appId).closedPhases).toEqual([
      "discovery",
      "implementation",
      "delivery",
    ]);
    database.$client.close();
    fs.rmSync(appDir, { recursive: true, force: true });
  });
});
