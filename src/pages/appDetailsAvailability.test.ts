import { describe, expect, it } from "vitest";
import { appDetailsAvailability } from "./appDetailsAvailability";

describe("appDetailsAvailability", () => {
  it("waits while the app list is loading and the id is not in it yet", () => {
    expect(
      appDetailsAvailability({
        appId: 1,
        appsLoading: true,
        loadedAppIds: [],
      }),
    ).toBe("wait");
  });

  it("is ready when the loaded list contains the id", () => {
    expect(
      appDetailsAvailability({
        appId: 1,
        appsLoading: false,
        loadedAppIds: [1],
      }),
    ).toBe("ready");
  });

  it("is missing only after the list has loaded without the id", () => {
    expect(
      appDetailsAvailability({
        appId: 1,
        appsLoading: false,
        loadedAppIds: [2],
      }),
    ).toBe("missing");
  });
});
