import { describe, expect, it } from "vitest";
import { shouldApplyFetchedChatMessages } from "./chatPanelMessages";

describe("shouldApplyFetchedChatMessages", () => {
  it("loads a snapshot into an empty thread", () => {
    expect(
      shouldApplyFetchedChatMessages({
        streaming: true,
        current: undefined,
        fetched: [{ role: "user", content: "Horse racing" }],
      }),
    ).toBe(true);
  });

  it("keeps an assistant reply that is already streaming on screen", () => {
    expect(
      shouldApplyFetchedChatMessages({
        streaming: true,
        current: [
          { role: "user", content: "Horse racing" },
          { role: "assistant", content: "What is the page name?" },
        ],
        fetched: [{ role: "user", content: "Horse racing" }],
      }),
    ).toBe(false);
  });

  it("fills in the assistant reply while the thread is still waiting", () => {
    expect(
      shouldApplyFetchedChatMessages({
        streaming: true,
        current: [{ role: "user", content: "Horse racing" }],
        fetched: [
          { role: "user", content: "Horse racing" },
          { role: "assistant", content: "What is the page name?" },
        ],
      }),
    ).toBe(true);
  });
});
