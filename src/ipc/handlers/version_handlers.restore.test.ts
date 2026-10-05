import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { apps, chats, messages } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import {
  NO_RESTORABLE_VERSION_MESSAGE,
  registerVersionHandlers,
  resolveTargetCommitHash,
  versionPreviewHandlerService,
} from "./version_handlers";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "restore-message-"));
  tempDirs.push(dir);
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
  await fs.writeFile(path.join(dir, "package.json"), "{}\n");
  await execFileAsync("git", ["add", "package.json"], { cwd: dir });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Dyad",
      "-c",
      "user.email=git@dyad.sh",
      "commit",
      "-m",
      "init",
    ],
    { cwd: dir },
  );
  return dir;
}

describe("resolveTargetCommitHash", () => {
  it("uses the kickoff sourceCommitHash when Discovery has no later commit", () => {
    const hash = resolveTargetCommitHash({
      chatMessages: [
        {
          role: "assistant",
          content: "Start Discovery.",
          sourceCommitHash: "kickoff",
          commitHash: null,
          chatTurnIntentId: null,
        },
        {
          role: "user",
          content: "Fatbud the bkk weed shop",
          sourceCommitHash: null,
          commitHash: null,
          chatTurnIntentId: null,
        },
      ],
      targetIndex: 1,
      initialCommitHash: null,
    });
    expect(hash).toBe("kickoff");
  });

  it("prefers the nearest assistant commitHash over an older commit", () => {
    const hash = resolveTargetCommitHash({
      chatMessages: [
        {
          role: "assistant",
          content: "older",
          sourceCommitHash: "old-start",
          commitHash: "old-end",
          chatTurnIntentId: null,
        },
        {
          role: "user",
          content: "middle",
          sourceCommitHash: null,
          commitHash: null,
          chatTurnIntentId: null,
        },
        {
          role: "assistant",
          content: "near",
          sourceCommitHash: "near-start",
          commitHash: null,
          chatTurnIntentId: null,
        },
        {
          role: "user",
          content: "restore me",
          sourceCommitHash: null,
          commitHash: null,
          chatTurnIntentId: null,
        },
      ],
      targetIndex: 3,
      initialCommitHash: "initial",
    });
    expect(hash).toBe("near-start");
  });

  it("returns null when every hash is null", () => {
    expect(
      resolveTargetCommitHash({
        chatMessages: [
          {
            role: "assistant",
            content: "hello",
            sourceCommitHash: null,
            commitHash: null,
            chatTurnIntentId: null,
          },
          {
            role: "user",
            content: "question",
            sourceCommitHash: null,
            commitHash: null,
            chatTurnIntentId: null,
          },
        ],
        targetIndex: 1,
        initialCommitHash: null,
      }),
    ).toBeNull();
  });
});

describe("restore to a message", () => {
  let harness: HandlerTestHarness;

  beforeAll(() => {
    registerVersionHandlers();
  });

  beforeEach(() => {
    harness = setupHandlerTestHarness();
  });

  afterEach(async () => {
    harness.dispose();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("warns when the message has no recorded version", async () => {
    const appPath = await tempRepo();
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "busy-iguana", path: appPath })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({ appId, title: "Discovery", initialCommitHash: null })
        .run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({ chatId, role: "assistant", content: "Start Discovery." })
      .run();
    const userId = Number(
      harness.db
        .insert(messages)
        .values({ chatId, role: "user", content: "Fatbud the bkk weed shop" })
        .run().lastInsertRowid,
    );

    const result = await versionPreviewHandlerService.restoreToMessage({
      appId,
      chatId,
      messageId: userId,
    });

    expect(result.notification).toEqual({
      kind: "warning",
      message: NO_RESTORABLE_VERSION_MESSAGE,
    });
    expect(result.createdChatId).toBeNull();
  });

  it("keeps the chosen user message in the source chat", async () => {
    const appPath = await tempRepo();
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "busy-iguana", path: appPath })
        .run().lastInsertRowid,
    );
    const chatId = Number(
      harness.db
        .insert(chats)
        .values({ appId, title: "Discovery", initialCommitHash: null })
        .run().lastInsertRowid,
    );
    harness.db
      .insert(messages)
      .values({
        chatId,
        role: "assistant",
        content: "Start Discovery.",
        sourceCommitHash: "kickoff",
      })
      .run();
    const userId = Number(
      harness.db
        .insert(messages)
        .values({ chatId, role: "user", content: "Fatbud the bkk weed shop" })
        .run().lastInsertRowid,
    );

    const result = await versionPreviewHandlerService.restoreToMessage({
      appId,
      chatId,
      messageId: userId,
      restoreCodebase: false,
    });

    expect(result.createdChatId).toEqual(expect.any(Number));
    const source = harness.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .all();
    expect(source.map((row) => row.content)).toEqual([
      "Start Discovery.",
      "Fatbud the bkk weed shop",
    ]);
    const forked = harness.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, result.createdChatId!))
      .all();
    expect(forked.map((row) => row.content)).toEqual(["Start Discovery."]);
  });
});
