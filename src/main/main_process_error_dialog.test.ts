import { describe, expect, it } from "vitest";
import { showMainProcessErrorDialog } from "./main_process_error_dialog";

describe("showMainProcessErrorDialog", () => {
  it("shows the dialog when the bridge env is unset", () => {
    expect(showMainProcessErrorDialog({})).toBe(true);
  });

  it("shows the dialog when the bridge env is 0", () => {
    expect(showMainProcessErrorDialog({ DYAD_BROWSER_BRIDGE: "0" })).toBe(true);
  });

  it("skips the dialog when the browser bridge is on", () => {
    expect(showMainProcessErrorDialog({ DYAD_BROWSER_BRIDGE: "1" })).toBe(
      false,
    );
  });
});
