import type { WindowSessionId } from "./types";

/**
 * A browser-bridge visit mints a new window id after the socket closes.
 * That visit must copy the saved tab list onto the new id, and cleanup must
 * keep the new id. A desktop window keeps the first-product-window rule.
 */
export function chatTabSessionRestorePlan(input: {
  senderIsBrowserBridge: boolean;
  mayMigrateLegacyChatTabSession: boolean;
  productWindowSessionIds: readonly WindowSessionId[];
  windowSessionId: WindowSessionId;
}): {
  adoptPriorSession: boolean;
  restorableWindowSessionIds: WindowSessionId[];
} {
  if (input.senderIsBrowserBridge) {
    const restorable = [...input.productWindowSessionIds];
    if (!restorable.includes(input.windowSessionId)) {
      restorable.push(input.windowSessionId);
    }
    return {
      adoptPriorSession: true,
      restorableWindowSessionIds: restorable,
    };
  }
  return {
    adoptPriorSession: input.mayMigrateLegacyChatTabSession,
    restorableWindowSessionIds: [...input.productWindowSessionIds],
  };
}
