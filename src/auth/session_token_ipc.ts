/**
 * Runs before a renderer IPC so the main process verifies a current Clerk
 * JWT. Kept free of IPC imports so the client generator can call it.
 * `clerk:set-session-token` is skipped so storing a token does not recurse.
 */
const SESSION_TOKEN_CHANNEL = "clerk:set-session-token";

type SessionTokenEnsure = () => Promise<void> | null;

let ensure: SessionTokenEnsure | null = null;

export function registerSessionTokenEnsure(
  next: SessionTokenEnsure | null,
): void {
  ensure = next;
}

export function ensureSessionTokenBeforeIpc(
  channel: string,
): Promise<void> | null {
  if (channel === SESSION_TOKEN_CHANNEL || !ensure) return null;
  return ensure();
}
