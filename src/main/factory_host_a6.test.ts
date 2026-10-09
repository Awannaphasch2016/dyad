// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats, factoryHostRuns, hitlQuestions } from "@/db/schema";
import { insertFactoryPhaseChats } from "@/ipc/utils/factory_phase_chats";
import type { HitlCaller } from "@/control_plane/hitl";
import { createFactoryHostBridgeServer } from "@/main/factory_host_bridge_server";
import {
  startFactoryRun,
  type FactoryRunDispatch,
} from "@/main/factory_host_service";
import { openFactoryRequestForRun } from "@/main/factory_host_request";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

const ORG = "org_wewebplus";
const PM_ANSWER = "Use Tiny Bakery";
const DEV_ANSWER = "Use React";

describe("factory request loop", () => {
  let harness: ChatFlowHarness;
  let server: ReturnType<typeof createFactoryHostBridgeServer>;
  let baseUrl: string;
  const prompts: string[] = [];
  const stops: Array<ReturnType<typeof openFactoryRequestForRun>> = [];
  let dispatchError: unknown = null;
  let dispatch: FactoryRunDispatch;

  const callers = new Map<string, HitlCaller>([
    [
      "pm",
      {
        orgId: ORG,
        userId: "user_pm",
        roleId: "project-manager",
        displayName: "Project Manager",
      },
    ],
    [
      "dev",
      {
        orgId: ORG,
        userId: "user_dev",
        roleId: "developer",
        displayName: "Developer",
      },
    ],
    [
      "outsider",
      {
        orgId: "org_other",
        userId: "user_out",
        roleId: "project-manager",
        displayName: "Outsider",
      },
    ],
  ]);

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
    });
    db.update(apps)
      .set({ ownerType: "org", ownerId: ORG })
      .where(eq(apps.id, harness.appId))
      .run();
    db.update(chats)
      .set({ title: "Implementation", chatMode: "local-agent" })
      .where(eq(chats.id, harness.chatId))
      .run();
    insertFactoryPhaseChats(harness.appId, { executionBackend: "dyad" });

    dispatch = async (intent) => {
      try {
        prompts.push(intent.prompt);
        const streamed = await harness.streamChat(intent.prompt, {
          chatId: intent.chatId,
        });
        const assistant = [...streamed.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (!assistant?.content) {
          throw new Error("The factory run stored no assistant message");
        }
        stops.push(
          openFactoryRequestForRun(db, intent.intentId, assistant.content),
        );
        return "accepted";
      } catch (error) {
        dispatchError = error;
        throw error;
      }
    };
    server = createFactoryHostBridgeServer({
      token: "machine-token",
      database: db,
      resolveCaller: async (token) => callers.get(token) ?? null,
      dispatchChatIntent: dispatch,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await harness?.dispose();
  });

  const request = (
    path: string,
    init: { method?: string; body?: unknown } = {},
    token = "machine-token",
  ) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const body =
        init.body === undefined ? undefined : JSON.stringify(init.body);
      const http = httpRequest(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
          authorization: `Bearer ${token}`,
        },
      });
      http.on("error", reject);
      http.on("response", (response) => {
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
      if (body !== undefined) http.write(body);
      http.end();
    });

  async function until(ready: () => boolean, label: string) {
    const started = Date.now();
    while (!ready()) {
      if (dispatchError) throw dispatchError;
      if (Date.now() - started > 60_000) {
        throw new Error(`${label} did not finish`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("asks the project manager, then the developer, then summarizes", async () => {
    await startFactoryRun(
      db,
      {
        appId: harness.appId,
        phase: "implementation",
        prompt: "tc=local-agent/factory-a6-pm",
        idempotencyKey: "a6:first",
      },
      dispatch,
      { requireLink: false },
    );
    await until(
      () =>
        stops.length >= 1 && db.select().from(hitlQuestions).all().length >= 1,
      "project manager question",
    );

    const path = `/v1/apps/${harness.appId}/phases/implementation/questions`;
    const asDev = await request(path, {}, "dev");
    expect(asDev.status).toBe(200);
    expect(asDev.body.questions[0].targetRoleId).toBe("project-manager");
    expect(asDev.body.questions[0].body).toBeNull();
    expect(asDev.body.questions[0].canAnswer).toBe(false);
    expect(asDev.body.questions[0].status).toBe("open");

    const asPm = await request(path, {}, "pm");
    expect(asPm.body.questions[0].body).toContain(
      "Which name should the page use?",
    );
    expect(asPm.body.questions[0].canAnswer).toBe(true);
    const outsider = await request(path, {}, "outsider");
    expect(outsider.status).toBe(404);

    const pmAnswer = await request(
      `${path}/${asPm.body.questions[0].id}/answers`,
      { method: "POST", body: { body: PM_ANSWER } },
      "pm",
    );
    expect(pmAnswer.status).toBe(200);
    await until(() => stops.length >= 2, "developer question");
    expect(prompts[1]).toContain(PM_ANSWER);
    expect(prompts[1]).toContain("Which name should the page use?");

    const listed = await request(path, {}, "dev");
    const devQuestion = listed.body.questions.find(
      (question: { targetRoleId: string }) =>
        question.targetRoleId === "developer",
    );
    const pmQuestion = listed.body.questions.find(
      (question: { targetRoleId: string }) =>
        question.targetRoleId === "project-manager",
    );
    expect(devQuestion.body).toContain("Which stack should the page use?");
    expect(devQuestion.canAnswer).toBe(true);
    expect(pmQuestion.body).toBeNull();

    const devAnswer = await request(
      `${path}/${devQuestion.id}/answers`,
      { method: "POST", body: { body: DEV_ANSWER } },
      "dev",
    );
    expect(devAnswer.status).toBe(200);
    await until(() => stops.length >= 3, "implementation summary");

    expect(prompts[2]).toContain(DEV_ANSWER);
    expect(db.select().from(factoryHostRuns).all()).toHaveLength(3);
    expect(db.select().from(hitlQuestions).all()).toHaveLength(2);
    expect(stops[0]?.stop).toBe("human-required");
    expect(stops[1]?.stop).toBe("human-required");
    expect(stops[2]).toEqual({
      stop: "ready-for-approval",
      questionId: null,
    });
    const hidden = await request(path, {}, "outsider");
    expect(hidden.status).toBe(404);
  }, 120_000);
});
