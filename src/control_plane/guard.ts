import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { sharingEnabled, sharingScope } from "./access";
import { appVisibleToAccount } from "./visibility";

const APP_ID_ARGUMENT_CHANNELS = new Set([
  "get-app",
  "get-chats",
  "create-chat",
]);

const CHAT_ID_ARGUMENT_CHANNELS = new Set([
  "get-chat",
  "get-chat-metadata",
  "delete-chat",
  "delete-messages",
  "chat:cancel",
  "chat:observe-submission-stop-policy",
]);

export type SharedAccountTarget =
  | { kind: "app"; id: number }
  | { kind: "chat"; id: number };

/** Which account-owned id an IPC input refers to, when it has one. */
export function sharedAccountTarget(
  channel: string,
  input: unknown,
): SharedAccountTarget | null {
  if (typeof input === "number") {
    if (APP_ID_ARGUMENT_CHANNELS.has(channel))
      return { kind: "app", id: input };
    if (CHAT_ID_ARGUMENT_CHANNELS.has(channel))
      return { kind: "chat", id: input };
    return null;
  }
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.appId === "number")
    return { kind: "app", id: record.appId };
  const encodedKey = record.encodedKey;
  if (encodedKey && typeof encodedKey === "object") {
    const appId = (encodedKey as Record<string, unknown>).appId;
    if (typeof appId === "number") return { kind: "app", id: appId };
  }
  if (typeof record.chatId === "number")
    return { kind: "chat", id: record.chatId };
  return null;
}

export async function enforceSharedAccount(
  event: { sender: { id: number } },
  channel: string,
  input: unknown,
): Promise<void> {
  if (!sharingEnabled()) return;
  const target = sharedAccountTarget(channel, input);
  if (!target) return;
  if (target.kind === "app") {
    await assertAppVisible(event, target.id);
    return;
  }
  await assertChatVisible(event, target.id);
}

export async function assertChatVisible(
  event: { sender: { id: number } },
  chatId: number,
) {
  const chat = db
    .select({ appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) {
    throw new DyadError("Chat not found", DyadErrorKind.NotFound);
  }
  return assertAppVisible(event, chat.appId);
}

export async function assertAppVisible(
  event: { sender: { id: number } },
  appId: number,
) {
  const app = db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  const scope = await sharingScope(event);
  if (
    scope &&
    !appVisibleToAccount(
      { ownerType: app.ownerType, ownerId: app.ownerId },
      scope.session.account,
    )
  ) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }
  return { app, scope };
}
