import { describe, expect, it } from "vitest";
import { titleBarAppLabel } from "./title_bar_app_label";

describe("titleBarAppLabel", () => {
  it("stays quiet while the list is loading and an app id is selected", () => {
    expect(
      titleBarAppLabel({
        selectedAppId: 4,
        loading: true,
        apps: [],
      }),
    ).toEqual({ text: "", quiet: true });
  });

  it("says no app is selected once the list has settled without one", () => {
    expect(
      titleBarAppLabel({
        selectedAppId: null,
        loading: false,
        apps: [],
      }),
    ).toEqual({ text: "No app selected", quiet: false });
  });

  it("shows the app name when the list contains the selected id", () => {
    expect(
      titleBarAppLabel({
        selectedAppId: 4,
        loading: false,
        apps: [{ id: 4, name: "Tiny Bakery" }],
      }),
    ).toEqual({ text: "Tiny Bakery", quiet: false });
  });
});
