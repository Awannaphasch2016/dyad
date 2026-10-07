import { describe, expect, it } from "vitest";
import { chatTabSessionRestorePlan } from "./chat_tab_session_restore";
import type { WindowSessionId } from "./types";

const electronWindow =
  "10000000-0000-4000-8000-000000000001" as WindowSessionId;
const bridgeWindow = "20000000-0000-4000-8000-000000000002" as WindowSessionId;
const secondElectron =
  "30000000-0000-4000-8000-000000000003" as WindowSessionId;

describe("chatTabSessionRestorePlan", () => {
  it("lets a browser-bridge visit adopt the saved tabs and keep its new id", () => {
    const plan = chatTabSessionRestorePlan({
      senderIsBrowserBridge: true,
      mayMigrateLegacyChatTabSession: false,
      productWindowSessionIds: [electronWindow],
      windowSessionId: bridgeWindow,
    });

    expect(plan.adoptPriorSession).toBe(true);
    expect(plan.restorableWindowSessionIds).toEqual([
      electronWindow,
      bridgeWindow,
    ]);
  });

  it("does not duplicate the bridge id when it is already restorable", () => {
    const plan = chatTabSessionRestorePlan({
      senderIsBrowserBridge: true,
      mayMigrateLegacyChatTabSession: false,
      productWindowSessionIds: [bridgeWindow],
      windowSessionId: bridgeWindow,
    });

    expect(plan.restorableWindowSessionIds).toEqual([bridgeWindow]);
  });

  it("lets only the first desktop window adopt another session", () => {
    const first = chatTabSessionRestorePlan({
      senderIsBrowserBridge: false,
      mayMigrateLegacyChatTabSession: true,
      productWindowSessionIds: [electronWindow],
      windowSessionId: electronWindow,
    });
    const second = chatTabSessionRestorePlan({
      senderIsBrowserBridge: false,
      mayMigrateLegacyChatTabSession: false,
      productWindowSessionIds: [electronWindow, secondElectron],
      windowSessionId: secondElectron,
    });

    expect(first.adoptPriorSession).toBe(true);
    expect(first.restorableWindowSessionIds).toEqual([electronWindow]);
    expect(second.adoptPriorSession).toBe(false);
    expect(second.restorableWindowSessionIds).toEqual([
      electronWindow,
      secondElectron,
    ]);
  });
});
