import { count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { factoryChatIdsToDrop, hasFactoryPhases } from "@/lib/factoryPhase";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { deleteChatJournals } from "@/ipc/services/chat_journal_cleanup";
import { entityDisposalBus } from "@/window_infrastructure/main/entity_disposal_bus";

const pruning = new Map<number, Promise<void>>();

/** Drop chats that are not a phase this app has already started. */
export function retainStartedFactoryPhaseChats(appId: number): Promise<void> {
  const current = pruning.get(appId);
  if (current) return current;
  const run = dropUnstartedChats(appId).finally(() => {
    pruning.delete(appId);
  });
  pruning.set(appId, run);
  return run;
}

async function dropUnstartedChats(appId: number): Promise<void> {
  const rows = await db.query.chats.findMany({
    where: eq(chats.appId, appId),
    columns: { id: true, title: true },
  });
  if (rows.length === 0) return;
  const counts = await db
    .select({ chatId: messages.chatId, total: count() })
    .from(messages)
    .where(
      inArray(
        messages.chatId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(messages.chatId);
  const startedIds = new Set(
    counts.filter((row) => row.total > 0).map((row) => row.chatId),
  );
  const dropIds = factoryChatIdsToDrop(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      started: startedIds.has(row.id),
    })),
  );
  for (const chatId of dropIds) {
    await deleteChatJournals(chatId);
    await db.delete(chats).where(eq(chats.id, chatId));
    entityDisposalBus.publish({ kind: "chat", id: chatId });
  }
}

export async function assertFactoryChatCreationOpen(
  appId: number,
): Promise<void> {
  const rows = await db.query.chats.findMany({
    where: eq(chats.appId, appId),
    columns: { id: true, title: true },
  });
  if (!hasFactoryPhases(rows)) return;
  throw new DyadError(
    "This app already has its three phases.",
    DyadErrorKind.Validation,
  );
}
