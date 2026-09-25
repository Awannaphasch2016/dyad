import { describe, expect, it } from "vitest";
import { isChatLockedByQuestionnaire } from "./questionnaireComposerLock";

describe("isChatLockedByQuestionnaire", () => {
  it("locks only the chat that still has questions waiting", () => {
    const pending = new Set([4]);
    expect(isChatLockedByQuestionnaire(4, pending)).toBe(true);
    expect(isChatLockedByQuestionnaire(5, pending)).toBe(false);
    expect(isChatLockedByQuestionnaire(undefined, pending)).toBe(false);
  });
});
