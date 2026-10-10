import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  answerHitlQuestion,
  createHitlQuestion,
  resumeAnsweredFactoryQuestions,
} from "@/control_plane/hitl_device";
import type { HitlCaller } from "@/control_plane/hitl";
import { apps, chats, factoryHostRuns, hitlQuestions } from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import { recordCursorFactoryRun } from "./factory_host_service";

const ORG = "org_wewebplus";
const AGENT = "bc-ef4536d3-9314-4a74-9b67-a051b72cabb0";
const FIRST_RUN = "run-97f4bbd7-0af8-483f-8c5d-c6c5059787bf";
const FOLLOW_RUN = "run-24e499a3-50ef-48aa-9e4f-b69c9a42804b";
const pm: HitlCaller = {
  orgId: ORG,
  userId: "user_pm",
  roleId: "project-manager",
  displayName: "PM",
};

function seed() {
  const database = createInMemoryTestDb();
  const appId = Number(
    database.insert(apps).values({ name: "Factory", path: "factory" }).run()
      .lastInsertRowid,
  );
  database
    .update(apps)
    .set({ ownerType: "org", ownerId: ORG })
    .where(eq(apps.id, appId))
    .run();
  let implementationChatId = 0;
  for (const title of ["Discovery", "Implementation", "Delivery"]) {
    const chatId = Number(
      database.insert(chats).values({ appId, title }).run().lastInsertRowid,
    );
    if (title === "Implementation") implementationChatId = chatId;
  }
  const stored = recordCursorFactoryRun(database, {
    appId,
    phase: "implementation",
    cursorAgentId: AGENT,
    cursorRunId: FIRST_RUN,
    prompt: "Ask the project manager",
    idempotencyKey: "c3:first",
  });
  const created = createHitlQuestion(database, {
    orgId: ORG,
    appId,
    phase: "implementation",
    chatId: implementationChatId,
    runId: stored.runId,
    stepId: "question",
    targetRoleId: "project-manager",
    body: "Which name should the page use?",
    idempotencyKey: `${stored.runId}:request`,
    gateBeadId: null,
  });
  return { database, appId, questionId: created.question.id };
}

describe("cursor run resume", () => {
  it("sends one follow-up on the same agent and does not start a local chat", async () => {
    const { database, questionId } = seed();
    const sent: string[] = [];
    const answered = await answerHitlQuestion(database, {
      questionId,
      caller: pm,
      body: "Tiny Bakery",
      dispatch: async () => {
        throw new Error("local chat must not start");
      },
      cursorFollowUp: async (input) => {
        sent.push(input.prompt);
        expect(input.cursorAgentId).toBe(AGENT);
        return { cursorRunId: FOLLOW_RUN };
      },
    });
    expect(answered.resolved).toBe(true);
    expect(sent).toEqual(["Which name should the page use?\n\nTiny Bakery"]);
    const rows = database.select().from(factoryHostRuns).all();
    expect(rows.map((row) => row.runId).sort()).toEqual(
      [`cursor-run:${FIRST_RUN}`, `cursor-run:${FOLLOW_RUN}`].sort(),
    );
    const follow = rows.find((row) => row.runId === `cursor-run:${FOLLOW_RUN}`);
    expect(follow?.cursorAgentId).toBe(AGENT);
    expect(follow?.idempotencyKey).toBe(`${questionId}:resume`);
    expect(rows.some((row) => row.runId.startsWith("gas-city-run:"))).toBe(
      false,
    );

    const again = await answerHitlQuestion(database, {
      questionId,
      caller: pm,
      body: "Tiny Bakery",
      cursorFollowUp: async () => {
        throw new Error("second answer must not follow up");
      },
    });
    expect(again.resolved).toBe(false);
    expect(database.select().from(factoryHostRuns).all()).toHaveLength(2);
    database.$client.close();
  });

  it("leaves the answer unresolved when no Cursor sender is registered", async () => {
    const { database, questionId } = seed();
    const answered = await answerHitlQuestion(database, {
      questionId,
      caller: pm,
      body: "Tiny Bakery",
      dispatch: async () => {
        throw new Error("local chat must not start");
      },
    });
    expect(answered.resolved).toBe(false);
    expect(database.select().from(factoryHostRuns).all()).toHaveLength(1);
    expect(database.select().from(hitlQuestions).all()[0]?.status).toBe(
      "answered",
    );
    database.$client.close();
  });

  it("retries the follow-up once after the sender failed", async () => {
    const { database, questionId } = seed();
    const crashed = await answerHitlQuestion(database, {
      questionId,
      caller: pm,
      body: "Tiny Bakery",
      cursorFollowUp: async () => {
        throw new Error("cursor unavailable");
      },
    });
    expect(crashed.resolved).toBe(false);
    let calls = 0;
    const started = await resumeAnsweredFactoryQuestions(
      database,
      async () => {
        throw new Error("local chat must not start");
      },
      async () => {
        calls += 1;
        return { cursorRunId: FOLLOW_RUN };
      },
    );
    expect(started).toBe(1);
    expect(calls).toBe(1);
    const again = await resumeAnsweredFactoryQuestions(
      database,
      undefined,
      async () => {
        throw new Error("accepted follow-up must not be sent again");
      },
    );
    expect(again).toBe(0);
    database.$client.close();
  });
});
