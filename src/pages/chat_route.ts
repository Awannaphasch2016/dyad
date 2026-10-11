export type ChatPageRedirect =
  | { kind: "stay" }
  | { kind: "home" }
  | { kind: "chat"; chatId: number; appId: number }
  | { kind: "app-details"; appId: number };

/**
 * An address with a chat id stays on /chat. An empty chat list redirects to
 * app details only after that list has loaded successfully.
 */
export function chatPageRedirect(input: {
  chatId: number | undefined;
  loading: boolean;
  fetchFailed: boolean;
  selectedAppId: number | null;
  chats: readonly { id: number; appId: number }[];
}): ChatPageRedirect {
  if (input.chatId || input.loading || input.fetchFailed) {
    return { kind: "stay" };
  }
  if (input.selectedAppId == null) {
    return { kind: "home" };
  }
  const first = input.chats[0];
  if (first) {
    return { kind: "chat", chatId: first.id, appId: first.appId };
  }
  return { kind: "app-details", appId: input.selectedAppId };
}
