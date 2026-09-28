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
