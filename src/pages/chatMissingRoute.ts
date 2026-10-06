export function isMissingChatOrAppError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === "Chat not found" || message === "App not found";
}

/**
 * Order of chats to confirm after a return.
 * The selected open tab comes first, then the address when it is one of the
 * open tabs (or when nothing was saved yet), then the other open tabs.
 * A tab the person closed is absent from `openChatIds` and is not reopened.
 */
export function restoredChatCandidateIds(input: {
  urlChatId: number | undefined;
  openChatIds: readonly number[];
  selectedChatId: number | null;
}): number[] {
  const open = input.openChatIds.filter((id) => Number.isInteger(id) && id > 0);
  const ids: number[] = [];
  const push = (id: number | null | undefined) => {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return;
    if (ids.includes(id)) return;
    ids.push(id);
  };

  if (input.selectedChatId !== null && open.includes(input.selectedChatId)) {
    push(input.selectedChatId);
  }
  if (
    input.urlChatId !== undefined &&
    (open.length === 0 || open.includes(input.urlChatId))
  ) {
    push(input.urlChatId);
  }
  for (const id of open) push(id);
  return ids;
}

export type ChatRouteConfirmPlan =
  | { action: "passthrough" }
  | { action: "open"; chatId: number; appId: number }
  | { action: "wait" }
  | { action: "ask-server" };

/**
 * A chat already in the loaded list opens immediately.
 * While that list is still loading, wait without asking and without clearing
 * the selected chat. Ask the server only after the list has settled without it.
 */
export function chatRouteConfirmPlan(input: {
  candidates: readonly number[];
  loadedChats: readonly { id: number; appId: number }[];
  listLoading: boolean;
}): ChatRouteConfirmPlan {
  if (input.candidates.length === 0) return { action: "passthrough" };
  for (const id of input.candidates) {
    const chat = input.loadedChats.find((item) => item.id === id);
    if (chat) return { action: "open", chatId: chat.id, appId: chat.appId };
  }
  if (input.listLoading) return { action: "wait" };
  return { action: "ask-server" };
}
