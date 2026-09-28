import { beforeEach, expect, it, vi } from "vitest";

const setSessionToken = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/ipc/types", () => ({
  ipc: {
    clerk: { setSessionToken },
  },
}));

import { publishSessionToken } from "./publish_session_token";

beforeEach(() => {
  setSessionToken.mockClear();
});

it("drops a token read that started for the previous account", async () => {
  let releasePrevious: (token: string) => void = () => undefined;
  const previous = new Promise<string>((resolve) => {
    releasePrevious = resolve;
  });
  const stored = publishSessionToken(() => previous);
  await Promise.resolve();
  const current = publishSessionToken(async () => "current-token");

  releasePrevious("previous-token");
  await Promise.all([stored, current]);

  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: "current-token" });
});

it("does not clear the stored token when the signed-in session has none yet", async () => {
  await expect(publishSessionToken(async () => undefined)).resolves.toBe(false);

  expect(setSessionToken).not.toHaveBeenCalled();
});

it("reports that a session token was stored", async () => {
  await expect(publishSessionToken(async () => "session-token")).resolves.toBe(
    true,
  );

  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: "session-token" });
});

it("clears the stored token on sign-out", async () => {
  await publishSessionToken(async () => null);

  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: null });
});

it("keeps a newer signed-in token ahead of a sign-out flicker", async () => {
  const flicker = publishSessionToken(async () => null);
  await Promise.resolve();
  await Promise.resolve();
  const current = publishSessionToken(async () => "current-token");

  await Promise.all([flicker, current]);

  expect(setSessionToken).toHaveBeenCalledTimes(1);
  expect(setSessionToken).toHaveBeenCalledWith({ token: "current-token" });
});
