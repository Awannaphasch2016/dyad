const tokens = new Map<number, string>();

/**
 * Safari reaches main through the Electron window's ipcRenderer, so its
 * Clerk token must not share that window's slot. A signed-out desktop
 * window clears only its own id.
 */
export const WEB_BRIDGE_SENDER_ID = -1;

export function rememberSessionToken(
  webContentsId: number,
  token: string | null,
): void {
  if (!token) {
    tokens.delete(webContentsId);
    return;
  }
  tokens.set(webContentsId, token);
}

export function sessionTokenFor(webContentsId: number): string | null {
  return tokens.get(webContentsId) ?? null;
}

export function sessionTokenForRequest(webContentsId: number): string | null {
  return (
    sessionTokenFor(webContentsId) ?? sessionTokenFor(WEB_BRIDGE_SENDER_ID)
  );
}

export function clearSessionTokensForTesting(): void {
  tokens.clear();
}
