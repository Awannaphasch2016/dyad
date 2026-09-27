const tokens = new Map<number, string>();

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

export function clearSessionTokensForTesting(): void {
  tokens.clear();
}
