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

  it("treats FINISHED with a request as a question", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "FINISHED",
        finalMessage: request,
        phase,
      }),
    ).toBe("question_opened");
  });

  it("lets a request beat a finish marker on a finished Cursor run", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "finished",
        finalMessage: `## Phase finished\n- **Page:** Tiny Bakery\n\n${request}`,
        phase,
      }),
    ).toBe("question_opened");
  });

  it("maps the other terminal Cursor statuses", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "ERROR",
        finalMessage: "boom",
        phase,
      }),
    ).toBe("agent_failed");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "ERROR",
        finalMessage: null,
        phase,
      }),
    ).toBe("agent_failed");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "CANCELLED",
        finalMessage: request,
        phase,
      }),
    ).toBe("agent_stopped_unclear");
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "EXPIRED",
        finalMessage: summary,
        phase,
      }),
    ).toBe("agent_stopped_unclear");
  });

  it("does not treat a summary heading as a finished Cursor run", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "FINISHED",
        finalMessage: summary,
        phase,
      }),
    ).toBe("agent_stopped_unclear");
  });

  it("finishes when the Cursor message has the phase-finished marker", () => {
    expect(
      classifyCursorFactoryStop({
        cursorStatus: "FINISHED",
        finalMessage: "## Phase finished\n- **Page:** Tiny Bakery",
        phase,
      }),
    ).toBe("agent_finished");
  });
});
