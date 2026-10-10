import { describe, expect, it } from "vitest";
import { classifyCursorFactoryStop } from "./cursorFactoryStop";

const phase = "implementation" as const;
const request =
  "## Request for project-manager\n\nWhich name should the page use?";
const summary = "## Implementation summary\n- **Page:** Tiny Bakery";

describe("classifyCursorFactoryStop", () => {
  it("waits while the Cursor run is not terminal", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "RUNNING",
        finalMessage: request,
        phase,
      }),
    ).toBeNull();
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "CREATING",
        finalMessage: null,
        phase,
      }),
    ).toBeNull();
  });

  it("treats FINISHED with a request as human-required", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "FINISHED",
        finalMessage: request,
        phase,
      }),
    ).toBe("human-required");
  });

  it("lets a request beat a summary on a finished Cursor run", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "finished",
        finalMessage: `${summary}\n\n${request}`,
        phase,
      }),
    ).toBe("human-required");
  });

  it("maps the other terminal Cursor statuses", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "ERROR",
        finalMessage: "boom",
        phase,
      }),
    ).toBe("recoverable-failure");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "ERROR",
        finalMessage: null,
        phase,
      }),
    ).toBe("infrastructure-error");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "CANCELLED",
        finalMessage: request,
        phase,
      }),
    ).toBe("abandoned");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "EXPIRED",
        finalMessage: summary,
        phase,
      }),
    ).toBe("abandoned");
  });

  it("is ready for approval when the finished message is only the summary", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "FINISHED",
        finalMessage: summary,
        phase,
      }),
    ).toBe("ready-for-approval");
  });
});
