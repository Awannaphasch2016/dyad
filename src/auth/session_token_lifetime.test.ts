import { expect, it } from "vitest";
import {
  SESSION_TOKEN_REFRESH_MARGIN_MS,
  SESSION_TOKEN_REFRESH_RETRY_MS,
  sessionTokenExpiresAtMs,
  sessionTokenNeedsRefresh,
  sessionTokenRefreshDelayMs,
  storedSessionTokenNeedsRefresh,
} from "./session_token_lifetime";

function sessionTokenWithExp(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

const now = 1_700_000_000_000;

it("reads the JWT expiry", () => {
  const exp = 1_700_000_060;
  expect(sessionTokenExpiresAtMs(sessionTokenWithExp(exp))).toBe(exp * 1000);
});

it("treats a malformed JWT as already due for refresh", () => {
  expect(sessionTokenExpiresAtMs("not-a-jwt")).toBeNull();
  expect(sessionTokenNeedsRefresh("not-a-jwt", now)).toBe(true);
  expect(sessionTokenRefreshDelayMs("not-a-jwt", now)).toBe(
    SESSION_TOKEN_REFRESH_RETRY_MS,
  );
});

it("refreshes inside the margin and waits outside it", () => {
  const fresh = sessionTokenWithExp((now + 50_000) / 1000);
  const due = sessionTokenWithExp(
    (now + SESSION_TOKEN_REFRESH_MARGIN_MS) / 1000,
  );

  expect(sessionTokenNeedsRefresh(fresh, now)).toBe(false);
  expect(sessionTokenNeedsRefresh(due, now)).toBe(true);
  expect(sessionTokenRefreshDelayMs(fresh, now)).toBe(
    50_000 - SESSION_TOKEN_REFRESH_MARGIN_MS,
  );
  expect(sessionTokenRefreshDelayMs(due, now)).toBe(
    SESSION_TOKEN_REFRESH_RETRY_MS,
  );
});

it("treats a missing stored token as due for refresh", () => {
  expect(storedSessionTokenNeedsRefresh(null, now)).toBe(true);
  expect(storedSessionTokenNeedsRefresh(undefined, now)).toBe(true);
});
