import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import type { ControlPlaneDb } from "./db";
import {
  deleteControlApp,
  insertControlApp,
  insertControlChat,
  insertControlMessage,
  listControlApps,
  listControlChats,
  listControlMessages,
  updateControlAppDetails,
  updateControlMessageContent,
} from "./repository";
import * as schema from "./schema";

describe("control plane apps", () => {
  it("keeps a private app off another user's list and shares an organization app", async () => {
    const client = new PGlite();
    const plane = drizzle(client, { schema });
    await migrate(plane, { migrationsFolder: "control-plane/drizzle" });
    const db = plane as unknown as ControlPlaneDb;
    await insertControlApp(db, {
      id: "app-private",
      owner: { type: "user", id: "user_a" },
      name: "Private page",
      slug: "private-page",
      githubOrg: null,
      githubRepo: null,
      githubBranch: null,
      supabaseProjectId: null,
    });
    await insertControlApp(db, {
      id: "app-shared",
      owner: { type: "org", id: "org_1" },
      name: "Shared page",
      slug: "shared-page",
      githubOrg: "bakery",
      githubRepo: "shared",
      githubBranch: "main",
      supabaseProjectId: null,
    });

    const ada = await listControlApps(db, { type: "user", id: "user_a" });
    const other = await listControlApps(db, { type: "user", id: "user_b" });
    const org = await listControlApps(db, { type: "org", id: "org_1" });

    expect(ada.map((app) => app.name)).toEqual(["Private page"]);
    expect(other).toEqual([]);
    expect(org.map((app) => app.name)).toEqual(["Shared page"]);
  });

  it("updates chat text and drops a deleted app", async () => {
    const client = new PGlite();
    const plane = drizzle(client, { schema });
    await migrate(plane, { migrationsFolder: "control-plane/drizzle" });
    const db = plane as unknown as ControlPlaneDb;
    await insertControlApp(db, {
      id: "app-1",
      owner: { type: "org", id: "org_1" },
      name: "Page",
      slug: "page",
      githubOrg: null,
      githubRepo: null,
      githubBranch: null,
      supabaseProjectId: null,
    });
    await insertControlChat(db, {
      id: "chat-1",
      appId: "app-1",
      title: "Discovery",
    });
    const transcript = {
      messages: [{ role: "assistant", content: "tool result" }],
      sdkVersion: "ai@v6",
    };
    await insertControlMessage(db, {
      id: "message-1",
      chatId: "chat-1",
      role: "assistant",
      content: "",
    });
    await updateControlMessageContent(
      db,
      "message-1",
      "The finished answer",
      transcript,
    );
    await updateControlAppDetails(db, "app-1", {
      name: "Page",
      slug: "page",
      githubOrg: "bakery",
      githubRepo: "page",
      githubBranch: "main",
      supabaseProjectId: null,
    });

    const messages = await listControlMessages(db, "chat-1");
    expect(messages.map((message) => message.content)).toEqual([
      "The finished answer",
    ]);
    expect(messages[0]?.aiMessagesJson).toEqual(transcript);
    const listed = await listControlApps(db, { type: "org", id: "org_1" });
    expect(listed[0]?.githubRepo).toBe("page");

    await deleteControlApp(db, "app-1");
    expect(await listControlApps(db, { type: "org", id: "org_1" })).toEqual([]);
    expect(await listControlChats(db, "app-1")).toEqual([]);
  });
});
