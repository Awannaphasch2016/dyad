import { describe, expect, it } from "vitest";
import {
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
