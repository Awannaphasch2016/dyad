import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  AI_MESSAGES_SDK_VERSION,
  appKnowledgeItems,
  apps,
  chats,
  messages,
  type AiMessagesJsonV6,
} from "@/db/schema";
import log from "electron-log";
import { withLock } from "@/ipc/utils/lock_utils";
import { getControlPlaneDb } from "./db";
import type { AccountOwner } from "./owner";
import { isLegacyUnownedApp, privateOwner } from "./owner";
import {
  deleteControlApp,
  insertControlApp,
  insertControlChat,
  insertControlKnowledge,
  insertControlMessage,
  listControlApps,
  listControlChats,
  listControlKnowledge,
  listControlMessages,
  updateControlAppDetails,
  updateControlChatTitle,
  updateControlMessageContent,
} from "./repository";

const logger = log.scope("control_plane_sync");

function storedTranscript(value: unknown): AiMessagesJsonV6 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { messages?: unknown; sdkVersion?: unknown };
  if (
    record.sdkVersion !== AI_MESSAGES_SDK_VERSION ||
    !Array.isArray(record.messages)
  ) {
    return null;
  }
  return value as AiMessagesJsonV6;
}

type Plane = NonNullable<Awaited<ReturnType<typeof getControlPlaneDb>>>;

/**
 * Claims this device's unowned apps into the signed-in user's private account,
 * then mirrors the active account into the local cache.
 */
export async function syncActiveAccount(
  userId: string,
  owner: AccountOwner,
): Promise<boolean> {
  try {
    const plane = await getControlPlaneDb();
    if (!plane) return false;
    await withLock(`control-plane-claim:${userId}`, async () => {
      await claimUnownedApps(plane, userId);
      await mirrorAccount(plane, owner);
    });
    return true;
  } catch (error) {
    logger.warn("Shared account sync skipped", error);
    return false;
  }
}

async function claimUnownedApps(plane: Plane, userId: string): Promise<void> {
  const owner = privateOwner(userId);
  const unowned = db
    .select()
    .from(apps)
    .where(isNull(apps.remoteId))
    .all()
    .filter(isLegacyUnownedApp);
  for (const app of unowned) {
    const remoteId = randomUUID();
    await insertControlApp(plane, {
      id: remoteId,
      owner,
      name: app.name,
      slug: app.path,
      githubOrg: app.githubOrg,
      githubRepo: app.githubRepo,
      githubBranch: app.githubBranch,
      supabaseProjectId: app.supabaseProjectId,
    });
    db.update(apps)
      .set({ remoteId, ownerType: "user", ownerId: userId })
      .where(eq(apps.id, app.id))
      .run();
    await pushAppChildren(plane, app.id, remoteId);
  }
}

export async function pushAppChildren(
  plane: Plane,
  localAppId: number,
  remoteAppId: string,
): Promise<void> {
  const localChats = db
    .select()
    .from(chats)
    .where(eq(chats.appId, localAppId))
    .all();
  for (const chat of localChats) {
    let remoteChatId = chat.remoteId;
    if (!remoteChatId) {
      remoteChatId = randomUUID();
      await insertControlChat(plane, {
        id: remoteChatId,
        appId: remoteAppId,
        title: chat.title,
      });
      db.update(chats)
        .set({ remoteId: remoteChatId })
        .where(eq(chats.id, chat.id))
        .run();
    } else {
      await updateControlChatTitle(plane, remoteChatId, chat.title);
    }
    const localMessages = db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .all();
    for (const message of localMessages) {
      if (message.remoteId) {
        await updateControlMessageContent(
          plane,
          message.remoteId,
          message.content,
          message.aiMessagesJson,
        );
        continue;
      }
      const remoteMessageId = randomUUID();
      await insertControlMessage(plane, {
        id: remoteMessageId,
        chatId: remoteChatId,
        role: message.role,
        content: message.content,
        aiMessagesJson: message.aiMessagesJson,
      });
      db.update(messages)
        .set({ remoteId: remoteMessageId })
        .where(eq(messages.id, message.id))
        .run();
    }
  }
  const items = db
    .select()
    .from(appKnowledgeItems)
    .where(eq(appKnowledgeItems.appId, localAppId))
    .all();
  for (const item of items) {
    if (item.remoteId) continue;
    const remoteItemId = randomUUID();
    await insertControlKnowledge(plane, {
      id: remoteItemId,
      appId: remoteAppId,
      title: item.title,
      url: item.url,
      addedBy: item.addedBy,
    });
    db.update(appKnowledgeItems)
      .set({ remoteId: remoteItemId })
      .where(eq(appKnowledgeItems.id, item.id))
      .run();
  }
}

async function mirrorAccount(plane: Plane, owner: AccountOwner): Promise<void> {
  const remoteApps = await listControlApps(plane, owner);
  for (const remote of remoteApps) {
    let local = db
      .select()
      .from(apps)
      .where(eq(apps.remoteId, remote.id))
      .get();
    if (!local) {
      const inserted = db
        .insert(apps)
        .values({
          name: remote.name,
          path: remote.slug,
          remoteId: remote.id,
          ownerType: owner.type,
          ownerId: owner.id,
          githubOrg: remote.githubOrg,
          githubRepo: remote.githubRepo,
          githubBranch: remote.githubBranch,
          supabaseProjectId: remote.supabaseProjectId,
        })
        .returning({ id: apps.id })
        .get();
      local = db.select().from(apps).where(eq(apps.id, inserted.id)).get();
    } else {
      db.update(apps)
        .set({
          ownerType: owner.type,
          ownerId: owner.id,
          name: remote.name,
          githubOrg: remote.githubOrg,
          githubRepo: remote.githubRepo,
          githubBranch: remote.githubBranch,
          supabaseProjectId: remote.supabaseProjectId,
        })
        .where(eq(apps.id, local.id))
        .run();
    }
    if (!local) continue;
    await pullAppChildren(plane, local.id, remote.id);
    await pushAppChildren(plane, local.id, remote.id);
  }
}

async function pullAppChildren(
  plane: Plane,
  localAppId: number,
  remoteAppId: string,
): Promise<void> {
  const remoteChats = await listControlChats(plane, remoteAppId);
  for (const remoteChat of remoteChats) {
    let localChat = db
      .select()
      .from(chats)
      .where(eq(chats.remoteId, remoteChat.id))
      .get();
    if (!localChat) {
      const inserted = db
        .insert(chats)
        .values({
          appId: localAppId,
          title: remoteChat.title,
          remoteId: remoteChat.id,
        })
        .returning({ id: chats.id })
        .get();
      localChat = db
        .select()
        .from(chats)
        .where(eq(chats.id, inserted.id))
        .get();
    } else if (localChat.title !== remoteChat.title) {
      db.update(chats)
        .set({ title: remoteChat.title })
        .where(eq(chats.id, localChat.id))
        .run();
    }
    if (!localChat) continue;
    const remoteMessages = await listControlMessages(plane, remoteChat.id);
    for (const remoteMessage of remoteMessages) {
      const existing = db
        .select()
        .from(messages)
        .where(eq(messages.remoteId, remoteMessage.id))
        .get();
      if (existing) {
        const sameTranscript =
          JSON.stringify(existing.aiMessagesJson ?? null) ===
          JSON.stringify(remoteMessage.aiMessagesJson ?? null);
        if (existing.content !== remoteMessage.content || !sameTranscript) {
          db.update(messages)
            .set({
              content: remoteMessage.content,
              aiMessagesJson: storedTranscript(remoteMessage.aiMessagesJson),
            })
            .where(eq(messages.id, existing.id))
            .run();
        }
        continue;
      }
      db.insert(messages)
        .values({
          chatId: localChat.id,
          role: remoteMessage.role === "assistant" ? "assistant" : "user",
          content: remoteMessage.content,
          aiMessagesJson: storedTranscript(remoteMessage.aiMessagesJson),
          remoteId: remoteMessage.id,
        })
        .run();
    }
  }
  const remoteItems = await listControlKnowledge(plane, remoteAppId);
  for (const item of remoteItems) {
    const existing = db
      .select()
      .from(appKnowledgeItems)
      .where(eq(appKnowledgeItems.remoteId, item.id))
      .get();
    if (existing) continue;
    db.insert(appKnowledgeItems)
      .values({
        appId: localAppId,
        title: item.title,
        url: item.url,
        addedBy: item.addedBy,
        remoteId: item.id,
      })
      .run();
  }
}

function sharedAppFields(app: typeof apps.$inferSelect) {
  return {
    name: app.name,
    slug: app.path,
    githubOrg: app.githubOrg,
    githubRepo: app.githubRepo,
    githubBranch: app.githubBranch,
    supabaseProjectId: app.supabaseProjectId,
  };
}

/** A new or still-local app joins the account that is active right now. */
export async function publishLocalApp(
  localAppId: number,
  owner: AccountOwner,
  userId: string,
): Promise<void> {
  try {
    await withLock(`control-plane-claim:${userId}`, async () => {
      const plane = await getControlPlaneDb();
      if (!plane) return;
      const app = db.select().from(apps).where(eq(apps.id, localAppId)).get();
      if (!app || app.remoteId) return;
      const stamped =
        app.ownerType && app.ownerId
          ? { type: app.ownerType, id: app.ownerId }
          : owner;
      const remoteId = randomUUID();
      await insertControlApp(plane, {
        id: remoteId,
        owner: stamped,
        ...sharedAppFields(app),
      });
      db.update(apps)
        .set({
          remoteId,
          ownerType: stamped.type,
          ownerId: stamped.id,
        })
        .where(eq(apps.id, app.id))
        .run();
      await pushAppChildren(plane, app.id, remoteId);
    });
  } catch (error) {
    logger.warn("Shared app publish skipped", error);
  }
}

/** Pushes name, git connection, and chat text for an app that already has a remote id. */
export async function refreshSharedApp(localAppId: number): Promise<void> {
  try {
    const plane = await getControlPlaneDb();
    if (!plane) return;
    const app = db.select().from(apps).where(eq(apps.id, localAppId)).get();
    if (!app?.remoteId) return;
    await updateControlAppDetails(plane, app.remoteId, sharedAppFields(app));
    await pushAppChildren(plane, app.id, app.remoteId);
  } catch (error) {
    logger.warn("Shared app refresh skipped", error);
  }
}

/** Drops the shared row after this device deletes the app, so the next sync does not recreate it. */
export async function forgetSharedApp(remoteId: string): Promise<void> {
  try {
    const plane = await getControlPlaneDb();
    if (!plane) return;
    await deleteControlApp(plane, remoteId);
  } catch (error) {
    logger.warn("Shared app delete skipped", error);
  }
}

export async function syncChatToAccount(chatId: number): Promise<void> {
  const chat = db
    .select({ appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) return;
  await syncOneApp(chat.appId);
}

export async function syncOneApp(localAppId: number): Promise<void> {
  try {
    const plane = await getControlPlaneDb();
    if (!plane) return;
    const app = db.select().from(apps).where(eq(apps.id, localAppId)).get();
    if (!app?.remoteId) return;
    await pushAppChildren(plane, app.id, app.remoteId);
    await pullAppChildren(plane, app.id, app.remoteId);
  } catch (error) {
    logger.warn("Shared app sync skipped", error);
  }
}
