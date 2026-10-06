import { describe, expect, it } from "vitest";
import {
  chatRouteConfirmPlan,
  isMissingChatOrAppError,
  restoredChatCandidateIds,
} from "./chatMissingRoute";

describe("isMissingChatOrAppError", () => {
  it("matches the two guard messages exactly", () => {
    expect(isMissingChatOrAppError(new Error("Chat not found"))).toBe(true);
    expect(isMissingChatOrAppError(new Error("App not found"))).toBe(true);
    expect(isMissingChatOrAppError("Chat not found")).toBe(true);
    expect(isMissingChatOrAppError("App not found")).toBe(true);
  });

  it("leaves longer and unrelated messages on the normal error path", () => {
    expect(isMissingChatOrAppError(new Error("Chat not found: 3"))).toBe(false);
    expect(
      isMissingChatOrAppError(new Error("Dyad browser bridge disconnected")),
    ).toBe(false);
  });
});

describe("restoredChatCandidateIds", () => {
  it("confirms the selected open tab, then the other open tabs", () => {
    expect(
      restoredChatCandidateIds({
        urlChatId: 20,
        openChatIds: [20, 21],
        selectedChatId: 20,
      }),
    ).toEqual([20, 21]);
  });

  it("does not reopen a chat that is absent from the open tabs", () => {
    expect(
      restoredChatCandidateIds({
        urlChatId: 10,
        openChatIds: [20],
        selectedChatId: 20,
      }),
    ).toEqual([20]);
  });

  it("opens a chat that is already in the loaded list", () => {
    expect(
      chatRouteConfirmPlan({
        candidates: [20, 21],
        loadedChats: [{ id: 20, appId: 4 }],
        listLoading: false,
      }),
    ).toEqual({ action: "open", chatId: 20, appId: 4 });
  });

  it("waits while the list is loading and does not ask yet", () => {
    expect(
      chatRouteConfirmPlan({
        candidates: [20],
        loadedChats: [],
        listLoading: true,
      }),
    ).toEqual({ action: "wait" });
  });

  it("asks the server only after the list has settled without the chat", () => {
    expect(
      chatRouteConfirmPlan({
        candidates: [20],
        loadedChats: [{ id: 21, appId: 4 }],
        listLoading: false,
      }),
    ).toEqual({ action: "ask-server" });
  });

  it("keeps a direct link when nothing was saved", () => {
    expect(
      restoredChatCandidateIds({
        urlChatId: 12,
        openChatIds: [],
        selectedChatId: null,
      }),
    ).toEqual([12]);
  });
});
