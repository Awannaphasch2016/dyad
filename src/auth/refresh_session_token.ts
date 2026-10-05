import {
  publishSessionToken,
  sessionTokenPublishSettled,
} from "./publish_session_token";
import { lastPublishedSessionToken } from "./session_token_slot";
import { storedSessionTokenNeedsRefresh } from "./session_token_lifetime";

type TokenRead = () => Promise<string | null | undefined>;

/**
 * Copy a new Clerk session JWT into the main process when the stored one is
 * missing or inside the refresh margin. A still-valid copy is left in place.
 */
export async function refreshSessionTokenIfNeeded(
  readToken: TokenRead,
  now = Date.now(),
): Promise<boolean> {
  if (!storedSessionTokenNeedsRefresh(lastPublishedSessionToken(), now)) {
    return true;
  }
  try {
    const stored = await publishSessionToken(readToken);
    if (stored) return true;
    // A newer read can supersede this one. Wait until that write lands so the
    // IPC that asked for a current JWT does not race ahead of it.
    await sessionTokenPublishSettled();
    return !storedSessionTokenNeedsRefresh(lastPublishedSessionToken());
  } catch {
    return false;
  }
}
