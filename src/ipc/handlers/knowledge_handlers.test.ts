import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { apps } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerKnowledgeHandlers } from "./knowledge_handlers";

describe("registerKnowledgeHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    harness = setupHandlerTestHarness();
    registerKnowledgeHandlers();
  });

  afterEach(() => {
    harness.dispose();
  });

  function seedApp(name: string): number {
    const result = harness.db.insert(apps).values({ name, path: name }).run();
    return Number(result.lastInsertRowid);
  }

  it("lists an app's items newest first", async () => {
    const appId = seedApp("app-1");
    const otherId = seedApp("app-2");
    await harness.invokeHandler("knowledge:create", {
      appId,
      title: "First",
      url: "https://example.com/a",
    });
    await harness.invokeHandler("knowledge:create", {
      appId,
      title: "Second",
      url: "https://example.com/b",
      addedBy: "Ada",
    });
    await harness.invokeHandler("knowledge:create", {
      appId: otherId,
      title: "Other app",
      url: "https://example.com/c",
    });

    const items = await harness.invokeHandler<
      Array<{ title: string; addedBy: string }>
    >("knowledge:list", { appId });

    expect(items.map((item) => item.title)).toEqual(["Second", "First"]);
    expect(items[0]?.addedBy).toBe("Ada");
  });

  it("rejects a missing app with NotFound", async () => {
    await expect(
      harness.invokeHandler("knowledge:list", { appId: 999 }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });

  it("rejects a blank title and a non-http link", async () => {
    const appId = seedApp("app-1");
    await expect(
      harness.invokeHandler("knowledge:create", {
        appId,
        title: "  ",
        url: "https://example.com/a",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    await expect(
      harness.invokeHandler("knowledge:create", {
        appId,
        title: "Docs",
        url: "ftp://example.com/a",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
  });

  it("deletes an item scoped to its app", async () => {
    const appId = seedApp("app-1");
    const created = await harness.invokeHandler<{ id: number }>(
      "knowledge:create",
      { appId, title: "Docs", url: "https://example.com/a" },
    );
    await harness.invokeHandler("knowledge:delete", {
      id: created.id,
      appId,
    });
    const items = await harness.invokeHandler<Array<unknown>>(
      "knowledge:list",
      { appId },
    );
    expect(items).toHaveLength(0);
  });

  it("refuses to delete another app's item", async () => {
    const appId = seedApp("app-1");
    const otherId = seedApp("app-2");
    const created = await harness.invokeHandler<{ id: number }>(
      "knowledge:create",
      { appId, title: "Docs", url: "https://example.com/a" },
    );
    await expect(
      harness.invokeHandler("knowledge:delete", {
        id: created.id,
        appId: otherId,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });
});
