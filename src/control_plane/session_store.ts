import { AsyncLocalStorage } from "node:async_hooks";

const tokens = new Map<number, string>();
const bridgeConnections = new AsyncLocalStorage<number>();

/**
 * Safari reaches main through the Electron window's ipcRenderer, so its
 * Clerk token must not share that window's slot. A signed-out desktop
 * window clears only its own id.
 *
 * Live browser sockets do not use this shared slot. Each websocket gets its
 * own connection id, and a request on that socket reads only that id.
 */
export const WEB_BRIDGE_SENDER_ID = -1;

let nextBridgeConnectionId = -2;

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

/** A new browser socket. The id is never a desktop webContents id or the shared slot. */
export function openBridgeConnection(): number {
  const connectionId = nextBridgeConnectionId;
  nextBridgeConnectionId -= 1;
  return connectionId;
}

export function closeBridgeConnection(connectionId: number): void {
  tokens.delete(connectionId);
}

export function runWithBridgeConnection<T>(
  connectionId: number,
  fn: () => T,
): T {
  return bridgeConnections.run(connectionId, fn);
}

export function bridgeConnectionId(): number | null {
  return bridgeConnections.getStore() ?? null;
}

export function sessionTokenForRequest(webContentsId: number): string | null {
  const connectionId = bridgeConnectionId();
  if (connectionId != null) return sessionTokenFor(connectionId);
  return (
    sessionTokenFor(webContentsId) ?? sessionTokenFor(WEB_BRIDGE_SENDER_ID)
  );
}

export function clearSessionTokensForTesting(): void {
  tokens.clear();
}
