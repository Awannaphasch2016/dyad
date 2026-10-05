/**
 * Clerk session JWTs expire on their own clock (about a minute by default).
 * The main process only verifies the copy the page stored. Refresh while the
 * copy still has more life than Clerk's verification clock skew (5s), so a
 * call does not present a JWT that verifyToken will reject.
 */
export const SESSION_TOKEN_REFRESH_MARGIN_MS = 15_000;

/** Back off when a refresh still did not produce a JWT outside the margin. */
export const SESSION_TOKEN_REFRESH_RETRY_MS = 5_000;

export function sessionTokenExpiresAtMs(token: string): number | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(segment)) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

export function sessionTokenNeedsRefresh(
  token: string,
  now = Date.now(),
): boolean {
  const expiresAt = sessionTokenExpiresAtMs(token);
  if (expiresAt == null) return true;
  return expiresAt - now <= SESSION_TOKEN_REFRESH_MARGIN_MS;
}

export function storedSessionTokenNeedsRefresh(
  token: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!token) return true;
  return sessionTokenNeedsRefresh(token, now);
}

/** Delay until the stored JWT should be replaced. Never schedules a tight loop. */
export function sessionTokenRefreshDelayMs(
  token: string,
  now = Date.now(),
): number {
  const expiresAt = sessionTokenExpiresAtMs(token);
  if (expiresAt == null) return SESSION_TOKEN_REFRESH_RETRY_MS;
  const delay = expiresAt - now - SESSION_TOKEN_REFRESH_MARGIN_MS;
  if (delay <= 0) return SESSION_TOKEN_REFRESH_RETRY_MS;
  return delay;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
