import { describe, expect, it } from "vitest";
import { resolveAppDetailsView } from "./app_details_view";

describe("resolveAppDetailsView", () => {
  it("waits while the list is loading and the address id is absent", () => {
    expect(
      resolveAppDetailsView({
        appId: 4,
        loading: true,
        fetchFailed: false,
        appIds: [],
      }),
    ).toBe("loading");
  });

  it("shows a load failure instead of a miss", () => {
    expect(
      resolveAppDetailsView({
        appId: 4,
        loading: false,
        fetchFailed: true,
        appIds: [],
      }),
    ).toBe("error");
  });

  it("says the app is missing only after a settled list lacks the id", () => {
    expect(
      resolveAppDetailsView({
        appId: 4,
        loading: false,
        fetchFailed: false,
        appIds: [1, 2],
      }),
    ).toBe("missing");
  });

  it("selects the app once the settled list contains the id", () => {
    expect(
      resolveAppDetailsView({
        appId: 4,
        loading: false,
        fetchFailed: false,
        appIds: [4],
      }),
    ).toBe("ready");
  });
});
