import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  apps,
  chats,
  factoryHostRuns,
  hitlQuestions,
  messages,
} from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import {
  cursorApiClient,
  type CursorFactoryClient,
} from "./cursor_factory_client";
import {
  cursorPhasePrompt,
  pollCursorFactoryRuns,
  settleCursorFactoryRun,
  startCursorPhase,
} from "./cursor_factory_host";
import { recordCursorFactoryRun } from "./factory_host_service";

const AGENT = "bc-agent";
const RUN = "run-1";

function seedApp() {
  const database = createInMemoryTestDb();
  const appId = Number(
    database.insert(apps).values({ name: "Factory", path: "factory" }).run()
      .lastInsertRowid,
  );
  database
    .update(apps)
    .set({
      ownerType: "org",
      ownerId: "org_wewebplus",
      githubOrg: "wewebplus",
      githubRepo: "tiny-bakery",
      githubBranch: "main",
    })
    .where(eq(apps.id, appId))
    .run();
  for (const title of ["Discovery", "Implementation", "Delivery"]) {
    database.insert(chats).values({ appId, title }).run();
  }
  return { database, appId };
}

function storedRun(
  database: ReturnType<typeof createInMemoryTestDb>,
  runId: string,
) {
  const run = database
    .select()
    .from(factoryHostRuns)
    .where(eq(factoryHostRuns.runId, runId))
    .get();
  if (!run) throw new Error("run was not stored");
  return run;
}

describe("cursor phase prompt", () => {
  it("starts discovery with the phase prompt and does not name the questions", () => {
    const prompt = cursorPhasePrompt("discovery", null);
    expect(prompt).toContain("Start Discovery.");
    expect(prompt).toContain("## Request for project-manager");
    expect(prompt).not.toContain("already approved");
    expect(prompt).not.toContain("Tiny Bakery");
  });
});

describe("settleCursorFactoryRun", () => {
  it("files a role question and leaves the request body out of the chat", async () => {
    const { database, appId } = seedApp();
    const stored = recordCursorFactoryRun(database, {
      appId,
      phase: "discovery",
      cursorAgentId: AGENT,
      cursorRunId: RUN,
      prompt: "Start Discovery.",
      idempotencyKey: "cursor-phase:discovery:run-1",
    });
    const client: CursorFactoryClient = {
      getRun: vi.fn(async () => ({
        status: "FINISHED",
        message:
          "## Request for project-manager\n\nWhich name should the page use?",
      })),
      followUp: vi.fn(async () => ({ cursorRunId: "run-2" })),
      createAgent: vi.fn(async () => ({ agentId: AGENT, cursorRunId: RUN })),
    };
    const settlement = await settleCursorFactoryRun(
      database,
      client,
      storedRun(database, stored.runId),
    );
    expect(settlement).toBe("question");
    const question = database.select().from(hitlQuestions).all();
    expect(question).toHaveLength(1);
    expect(question[0]?.targetRoleId).toBe("project-manager");
    expect(question[0]?.body).toContain("Which name should the page use?");
    expect(database.select().from(messages).all()).toHaveLength(0);
    database.$client.close();
  });

  it("writes a summary into the phase chat and does not poll the run again", async () => {
    const { database, appId } = seedApp();
    const stored = recordCursorFactoryRun(database, {
      appId,
      phase: "discovery",
      cursorAgentId: AGENT,
      cursorRunId: RUN,
      prompt: "Start Discovery.",
      idempotencyKey: "cursor-phase:discovery:run-1",
    });
    const client: CursorFactoryClient = {
      getRun: vi.fn(async () => ({
        status: "FINISHED",
        message: "## Discovery summary\n- **Page name:** Tiny Bakery",
      })),
      followUp: vi.fn(),
      createAgent: vi.fn(),
    };
    expect(
      await settleCursorFactoryRun(
        database,
        client,
        storedRun(database, stored.runId),
      ),
    ).toBe("summary");
    expect(database.select().from(hitlQuestions).all()).toHaveLength(0);
    expect(database.select().from(messages).all()[0]?.content).toContain(
      "## Discovery summary",
    );
    await pollCursorFactoryRuns(database, client);
    expect(client.getRun).toHaveBeenCalledOnce();
    database.$client.close();
  });
});

describe("startCursorPhase", () => {
  it("creates one agent for the app repository and does not start a second while it is open", async () => {
    const { database, appId } = seedApp();
    let prompt = "";
    const createAgent = vi.fn(async (input: { prompt: string }) => {
      prompt = input.prompt;
      return { agentId: AGENT, cursorRunId: RUN };
    });
    const client: CursorFactoryClient = {
      getRun: vi.fn(),
      followUp: vi.fn(),
      createAgent,
    };
    expect(
      await startCursorPhase(database, client, {
        appId,
        phase: "discovery",
      }),
    ).toEqual({ started: true });
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "https://github.com/wewebplus/tiny-bakery",
        ref: "main",
      }),
    );
    expect(prompt).toContain("Start Discovery.");
    expect(prompt).not.toContain("already approved");
    expect(
      await startCursorPhase(database, client, {
        appId,
        phase: "discovery",
      }),
    ).toEqual({ started: true });
    expect(createAgent).toHaveBeenCalledOnce();
    expect(
      await startCursorPhase(database, null, { appId, phase: "discovery" }),
    ).toEqual({ started: false });
    database.$client.close();
  });
});

describe("cursorApiClient", () => {
  it("does not put the key in an error", async () => {
    const key = "cursor-secret-key";
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ message: `bad ${key}` }), {
        status: 500,
      });
    });
    const client = cursorApiClient(key, fetchImpl);
    await expect(client.getRun("agent", "run")).rejects.toThrow(
      /bad \[redacted\]/,
    );
  });
});
