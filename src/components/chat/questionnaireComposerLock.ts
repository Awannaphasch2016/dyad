/** The composer stays closed while this chat still has questions to answer. */
export function isChatLockedByQuestionnaire(
  chatId: number | undefined,
  pendingChatIds: ReadonlySet<number> | ReadonlyMap<number, unknown>,
): boolean {
  return chatId != null && pendingChatIds.has(chatId);
}
