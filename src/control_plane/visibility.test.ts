import { describe, expect, it } from "vitest";
import { displayNameTaken, selectVisibleApps } from "./visibility";

describe("selectVisibleApps", () => {
  const apps = [
    { id: 1, ownerType: "user" as const, ownerId: "user_a" },
    { id: 2, ownerType: "org" as const, ownerId: "org_1" },
    { id: 3, ownerType: "user" as const, ownerId: "user_b" },
    { id: 4, ownerType: null, ownerId: null },
  ];

  it("returns only the active account", () => {
    expect(
      selectVisibleApps(apps, { type: "user", id: "user_a" }).map(
        (app) => app.id,
      ),
    ).toEqual([1]);
    expect(
      selectVisibleApps(apps, { type: "org", id: "org_1" }).map(
        (app) => app.id,
      ),
    ).toEqual([2]);
  });

  it("returns every app when sharing is off", () => {
    expect(selectVisibleApps(apps, null)).toHaveLength(4);
  });

  it("lets another account reuse a display name", () => {
    expect(
      displayNameTaken([{ id: 1, ownerType: "user", ownerId: "user_a" }], {
        type: "org",
        id: "org_1",
      }),
    ).toBe(false);
  });

  it("still blocks a name that this device has not claimed yet", () => {
    expect(
      displayNameTaken([{ id: 4, ownerType: null, ownerId: null }], {
        type: "org",
        id: "org_1",
      }),
    ).toBe(true);
  });
});
