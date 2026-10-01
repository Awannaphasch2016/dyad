import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setDatabaseForTesting } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadErrorKind } from "@/errors/dyad_error";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { setSessionVerifierForTesting } from "./access";
import { enforceSharedAccount, sharedAccountTarget } from "./guard";
import {
  clearSessionTokensForTesting,
  rememberSessionToken,
} from "./session_store";

describe("sharedAccountTarget", () => {
  it("reads an app id from an object, a machine key, or a bare argument", () => {
    expect(sharedAccountTarget("run-app", { appId: 4 })).toEqual({
      kind: "app",
      id: 4,
    });
    expect(
      sharedAccountTarget("distributed-machine:dispatch", {
        encodedKey: { appId: 9 },
      }),
    ).toEqual({ kind: "app", id: 9 });
    expect(sharedAccountTarget("get-app", 3)).toEqual({ kind: "app", id: 3 });
    expect(sharedAccountTarget("create-chat", 8)).toEqual({
      kind: "app",
      id: 8,
    });
  });

  it("reads a chat id from chat actions", () => {
    expect(sharedAccountTarget("update-chat", { chatId: 12 })).toEqual({
      kind: "chat",
      id: 12,
    });
    expect(sharedAccountTarget("delete-chat", 12)).toEqual({
      kind: "chat",
      id: 12,
    });
    expect(sharedAccountTarget("chat:cancel", 12)).toEqual({
      kind: "chat",
      id: 12,
    });
  });

  it("ignores actions that do not name an account-owned row", () => {
    expect(sharedAccountTarget("list-apps", undefined)).toBeNull();
    expect(sharedAccountTarget("get-chats", undefined)).toBeNull();
    expect(
      sharedAccountTarget("select-app-for-preview", { appId: null }),
    ).toBeNull();
    expect(sharedAccountTarget("github:list-repos", undefined)).toBeNull();
  });
});

describe("enforceSharedAccount", () => {
  const previous = {
    publishable: process.env.CLERK_PUBLISHABLE_KEY,
    secret: process.env.CLERK_SECRET_KEY,
    database: process.env.WEWEBPLUS_DATABASE_URL,
  };
  const event = { sender: { id: 4 } };
  let testDb: TestDb | null = null;

  afterEach(() => {
    setSessionVerifierForTesting(null);
    clearSessionTokensForTesting();
    setDatabaseForTesting(null);
    testDb?.$client.close();
    testDb = null;
    restoreEnv("CLERK_PUBLISHABLE_KEY", previous.publishable);
    restoreEnv("CLERK_SECRET_KEY", previous.secret);
    restoreEnv("WEWEBPLUS_DATABASE_URL", previous.database);
  });

  it("rejects an app or chat that belongs to another account", async () => {
    testDb = createInMemoryTestDb();
    setDatabaseForTesting(testDb);
    enableSharing();
    const app = testDb
      .insert(apps)
      .values({
        name: "Private",
        path: "private",
        ownerType: "user",
        ownerId: "user_b",
      })
      .returning()
      .get();
    const chat = testDb
      .insert(chats)
      .values({ appId: app.id })
      .returning()
      .get();

    await expect(
      enforceSharedAccount(event, "run-app", { appId: app.id }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    await expect(
      enforceSharedAccount(event, "get-app-upgrades", { appId: app.id }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    await expect(
      enforceSharedAccount(event, "delete-chat", chat.id),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    await expect(
      enforceSharedAccount(event, "chat:count-tokens", { chatId: chat.id }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });

    testDb
      .update(apps)
      .set({ ownerType: "org", ownerId: "org_1" })
      .where(eq(apps.id, app.id))
      .run();
    await expect(
      enforceSharedAccount(event, "run-app", { appId: app.id }),
    ).resolves.toBeUndefined();
    await expect(
      enforceSharedAccount(event, "chat:add-dep", { chatId: chat.id }),
    ).resolves.toBeUndefined();
  });

  it("leaves local apps alone when sharing is off", async () => {
    delete process.env.WEWEBPLUS_DATABASE_URL;
    await expect(
      enforceSharedAccount(event, "run-app", { appId: 1 }),
    ).resolves.toBeUndefined();
  });
});

function enableSharing() {
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
  process.env.CLERK_SECRET_KEY = "sk_test_example";
  process.env.WEWEBPLUS_DATABASE_URL = "postgres://example";
  rememberSessionToken(4, "token");
  setSessionVerifierForTesting(async () => ({
    userId: "user_a",
    orgId: "org_1",
    roleId: "project-manager",
    canInvite: true,
    displayName: "A",
    member: true,
  }));
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
