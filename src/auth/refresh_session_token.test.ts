import { beforeEach, expect, it, vi } from "vitest";

const setSessionToken = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/ipc/types", () => ({
  ipc: {
    clerk: { setSessionToken },
  },
}));

import { refreshSessionTokenIfNeeded } from "./refresh_session_token";
import {
  clearPublishedSessionTokenForTesting,
  lastPublishedSessionToken,
  notePublishedSessionToken,
} from "./session_token_slot";

function sessionTokenWithExp(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

const now = 1_700_000_000_000;

beforeEach(() => {
  setSessionToken.mockReset();
  setSessionToken.mockResolvedValue(undefined);
  clearPublishedSessionTokenForTesting();
});

it("leaves a JWT that is still outside the refresh margin", async () => {
  const current = sessionTokenWithExp((now + 50_000) / 1000);
  notePublishedSessionToken(current);
  const read = vi.fn(async () => "next-token");

  await expect(refreshSessionTokenIfNeeded(read, now)).resolves.toBe(true);

  expect(read).not.toHaveBeenCalled();
  expect(setSessionToken).not.toHaveBeenCalled();
  expect(lastPublishedSessionToken()).toBe(current);
});

it("stores a new JWT when the copy is inside the refresh margin", async () => {
  notePublishedSessionToken(sessionTokenWithExp(now / 1000));
  const next = sessionTokenWithExp((now + 60_000) / 1000);

  await expect(
    refreshSessionTokenIfNeeded(async () => next, now),
  ).resolves.toBe(true);

  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: next });
  expect(lastPublishedSessionToken()).toBe(next);
});

it("stores a JWT when the main process has not been given one yet", async () => {
  await expect(
    refreshSessionTokenIfNeeded(async () => "session-token", now),
  ).resolves.toBe(true);

  expect(setSessionToken).toHaveBeenCalledWith({ token: "session-token" });
  expect(lastPublishedSessionToken()).toBe("session-token");
});

it("waits for a newer JWT before the superseded refresh resolves", async () => {
  let releaseFirst: (token: string) => void = () => undefined;
  let releaseSecond: (token: string) => void = () => undefined;
  const firstRead = new Promise<string>((resolve) => {
    releaseFirst = resolve;
  });
  const secondRead = new Promise<string>((resolve) => {
    releaseSecond = resolve;
  });
  let firstSettled = false;
  const first = refreshSessionTokenIfNeeded(() => firstRead, now).then(
    (stored) => {
      firstSettled = true;
      return stored;
    },
  );
  await Promise.resolve();
  const second = refreshSessionTokenIfNeeded(() => secondRead, now);
  releaseFirst(sessionTokenWithExp(now / 1000));
  await Promise.resolve();
  await Promise.resolve();
  expect(firstSettled).toBe(false);

  const next = sessionTokenWithExp(Math.floor((Date.now() + 60_000) / 1000));
  releaseSecond(next);
  await expect(second).resolves.toBe(true);
  await expect(first).resolves.toBe(true);
  expect(lastPublishedSessionToken()).toBe(next);
  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: next });
});

it("does not clear the stored JWT when Clerk has no replacement yet", async () => {
  const current = sessionTokenWithExp(now / 1000);
  notePublishedSessionToken(current);

  await expect(
    refreshSessionTokenIfNeeded(async () => undefined, now),
  ).resolves.toBe(false);

  expect(setSessionToken).not.toHaveBeenCalled();
  expect(lastPublishedSessionToken()).toBe(current);
});
