import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { apps, chats, factoryHostRuns } from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import {
  CURSOR_RUN_PREFIX,
  FactoryHostError,
  readFactoryRun,
  recordCursorFactoryRun,
} from "./factory_host_service";

const AGENT = "bc-ef4536d3-9314-4a74-9b67-a051b72cabb0";
const FIRST_RUN = "run-97f4bbd7-0af8-483f-8c5d-c6c5059787bf";
const SECOND_RUN = "run-24e499a3-50ef-48aa-9e4f-b69c9a42804b";

function seedApp() {
  const database = createInMemoryTestDb();
  const appId = Number(
    database.insert(apps).values({ name: "Factory", path: "factory" }).run()
      .lastInsertRowid,
  );
  for (const title of ["Discovery", "Implementation", "Delivery"]) {
    database.insert(chats).values({ appId, title }).run();
  }
  return { database, appId };
}

describe("recordCursorFactoryRun", () => {
  it("writes a cursor-run row and reads the agent id and run id back", () => {
    const { database, appId } = seedApp();
    const stored = recordCursorFactoryRun(database, {
      appId,
      phase: "implementation",
      cursorAgentId: AGENT,
      cursorRunId: FIRST_RUN,
      prompt: "Which name should the page use?",
      idempotencyKey: "c1:first",
    });
    expect(stored.runId).toBe(`${CURSOR_RUN_PREFIX}${FIRST_RUN}`);
    expect(stored.cursorAgentId).toBe(AGENT);
    expect(stored.cursorRunId).toBe(FIRST_RUN);
    expect(stored.phase).toBe("implementation");
    expect(stored.status).toBe("running");

    const again = readFactoryRun(database, stored.runId);
    expect(again).toMatchObject({
      runId: stored.runId,
      cursorAgentId: AGENT,
      cursorRunId: FIRST_RUN,
    });
    const row = database
      .select()
      .from(factoryHostRuns)
      .where(eq(factoryHostRuns.runId, stored.runId))
      .get();
    expect(row?.intentId).toBe(stored.runId);
    expect(row?.cursorAgentId).toBe(AGENT);
    database.$client.close();
  });

  it("stores a second run for the same agent without reusing the intent id", () => {
    const { database, appId } = seedApp();
    const first = recordCursorFactoryRun(database, {
      appId,
      phase: "implementation",
      cursorAgentId: AGENT,
      cursorRunId: FIRST_RUN,
      prompt: "Ask the project manager",
      idempotencyKey: "c1:first",
    });
    const second = recordCursorFactoryRun(database, {
      appId,
      phase: "implementation",
      cursorAgentId: AGENT,
      cursorRunId: SECOND_RUN,
      prompt: "Ask the developer",
      idempotencyKey: "c1:second",
    });
    expect(second.runId).not.toBe(first.runId);
    expect(second.cursorAgentId).toBe(AGENT);
    expect(database.select().from(factoryHostRuns).all()).toHaveLength(2);
    const replay = recordCursorFactoryRun(database, {
      appId,
      phase: "implementation",
      cursorAgentId: AGENT,
      cursorRunId: FIRST_RUN,
      prompt: "Ask the project manager",
      idempotencyKey: "c1:first",
    });
    expect(replay.runId).toBe(first.runId);
    expect(database.select().from(factoryHostRuns).all()).toHaveLength(2);
    database.$client.close();
  });

  it("refuses to reuse a cursor run id for a different agent", () => {
    const { database, appId } = seedApp();
    recordCursorFactoryRun(database, {
      appId,
      phase: "implementation",
      cursorAgentId: AGENT,
      cursorRunId: FIRST_RUN,
      prompt: "Ask the project manager",
      idempotencyKey: "c1:first",
    });
    expect(() =>
      recordCursorFactoryRun(database, {
        appId,
        phase: "implementation",
        cursorAgentId: "bc-other",
        cursorRunId: FIRST_RUN,
        prompt: "Ask the project manager",
        idempotencyKey: "c1:other",
      }),
    ).toThrow(FactoryHostError);
    database.$client.close();
  });
});
