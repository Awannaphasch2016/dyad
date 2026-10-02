import { expect, it } from "vitest";
import { isLegacyUnownedApp } from "./owner";

it("claims only an app that has no account yet", () => {
  expect(
    isLegacyUnownedApp({ remoteId: null, ownerType: null, ownerId: null }),
  ).toBe(true);
  expect(
    isLegacyUnownedApp({
      remoteId: null,
      ownerType: "org",
      ownerId: "org_1",
    }),
  ).toBe(false);
  expect(
    isLegacyUnownedApp({
      remoteId: null,
      ownerType: "user",
      ownerId: "user_1",
    }),
  ).toBe(false);
  expect(
    isLegacyUnownedApp({
      remoteId: "remote",
      ownerType: null,
      ownerId: null,
    }),
  ).toBe(false);
});
