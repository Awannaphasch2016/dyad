import { describe, expect, it } from "vitest";
import { chatPageRedirect } from "./chat_route";

describe("chatPageRedirect", () => {
  it("stays on a chat address", () => {
    expect(
      chatPageRedirect({
        chatId: 9,
        loading: false,
        fetchFailed: false,
        selectedAppId: 4,
        chats: [],
      }),
    ).toEqual({ kind: "stay" });
  });

  it("waits while the chat list is loading", () => {
    expect(
      chatPageRedirect({
        chatId: undefined,
        loading: true,
        fetchFailed: false,
        selectedAppId: 4,
        chats: [],
      }),
    ).toEqual({ kind: "stay" });
  });

  it("does not redirect when the chat fetch failed", () => {
    expect(
      chatPageRedirect({
        chatId: undefined,
        loading: false,
        fetchFailed: true,
        selectedAppId: 4,
        chats: [],
      }),
    ).toEqual({ kind: "stay" });
  });

  it("opens app details after a successful empty chat list", () => {
    expect(
      chatPageRedirect({
        chatId: undefined,
        loading: false,
        fetchFailed: false,
        selectedAppId: 4,
        chats: [],
      }),
    ).toEqual({ kind: "app-details", appId: 4 });
  });

  it("opens the first chat when the list has one", () => {
    expect(
      chatPageRedirect({
        chatId: undefined,
        loading: false,
        fetchFailed: false,
        selectedAppId: 4,
        chats: [{ id: 9, appId: 4 }],
      }),
    ).toEqual({ kind: "chat", chatId: 9, appId: 4 });
  });
});
