import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  apps,
  chats,
  factoryPhaseApprovals,
  factoryPhaseMachines,
  hitlQuestions,
  messages,
} from "@/db/schema";
import { createInMemoryTestDb } from "@/testing/test_db";
import {
  answerFactoryPhase,
  approveFactoryPhase,
  enterFactoryPhase,
  rejectFactoryPhase,
} from "./factory_phase_controller";

function seedApp() {
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
  for (const title of ["Discovery", "Implementation", "Delivery"]) {
    database.insert(chats).values({ appId, title }).run();
  }
  return { database, appId };
}

function status(
  database: ReturnType<typeof createInMemoryTestDb>,
  phase: string,
): string | undefined {
  return database
    .select()
    .from(factoryPhaseMachines)
    .all()
    .find((row) => row.phase === phase)?.status;
}

describe("factory phase controller", () => {
  it("walks discovery, implementation, and delivery when the script is on", async () => {
    const { database, appId } = seedApp();
    expect(
      await enterFactoryPhase(database, {
        appId,
        phase: "discovery",
        script: true,
        cursorClient: null,
      }),
    ).toEqual({ started: true });
    expect(status(database, "discovery")).toBe("waiting_for_answer");
    expect(status(database, "implementation")).toBe("locked");
    const question = database.select().from(hitlQuestions).all()[0];
    expect(question?.targetRoleId).toBe("project-manager");

    await answerFactoryPhase(database, {
      appId,
      questionId: question!.id,
      answer: "Northwind",
      script: true,
    });
    expect(status(database, "discovery")).toBe("awaiting_review");
    expect(database.select().from(messages).all()[0]?.content).toContain(
      "## Discovery summary",
    );

    await rejectFactoryPhase(database, {
      appId,
      phase: "discovery",
      feedback: "Use a shorter hero",
      script: true,
    });
    expect(status(database, "discovery")).toBe("waiting_for_answer");
    expect(status(database, "implementation")).toBe("locked");
    const openQuestionId = database
      .select()
      .from(factoryPhaseMachines)
      .all()
      .find((row) => row.phase === "discovery")?.openQuestionId;
    const second = database
      .select()
      .from(hitlQuestions)
      .all()
      .find((row) => row.id === openQuestionId);
    await answerFactoryPhase(database, {
      appId,
      questionId: second!.id,
      answer: "Northwind",
      script: true,
    });
    expect(status(database, "discovery")).toBe("awaiting_review");

    await approveFactoryPhase(database, {
      appId,
      phase: "discovery",
      script: true,
    });
    expect(status(database, "discovery")).toBe("approved");
    expect(status(database, "implementation")).toBe("waiting_for_answer");
    const developer = database
      .select()
      .from(hitlQuestions)
      .all()
      .find((row) => row.targetRoleId === "developer" && row.status === "open");
    await answerFactoryPhase(database, {
      appId,
      questionId: developer!.id,
      answer: "It matches.",
      script: true,
    });
    expect(status(database, "implementation")).toBe("awaiting_review");
    await approveFactoryPhase(database, {
      appId,
      phase: "implementation",
      script: true,
    });
    expect(status(database, "implementation")).toBe("approved");
    expect(status(database, "delivery")).toBe("awaiting_review");
    expect(
      database
        .select()
        .from(messages)
        .all()
        .some((message) => message.content.includes("## Delivery summary")),
    ).toBe(true);
    await approveFactoryPhase(database, {
      appId,
      phase: "delivery",
      script: true,
    });
    expect(status(database, "delivery")).toBe("approved");
    expect(
      database
        .select()
        .from(factoryPhaseApprovals)
        .all()
        .map((row) => row.phase)
        .sort(),
    ).toEqual(["delivery", "discovery", "implementation"]);
    database.$client.close();
  });
});
