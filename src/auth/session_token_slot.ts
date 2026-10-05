/** Last JWT the main process accepted into its session map. */
let published: string | null | undefined;

export function notePublishedSessionToken(token: string | null): void {
  published = token;
}

export function lastPublishedSessionToken(): string | null | undefined {
  return published;
}

export function clearPublishedSessionTokenForTesting(): void {
  published = undefined;
}
