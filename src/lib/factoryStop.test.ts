import { describe, expect, it } from "vitest";
import { classifyFactoryStop } from "./factoryStop";

const phase = "discovery" as const;
const request = "## Request for project-manager\n\nWhich name?";
const summary = "## Discovery summary\n- **Page name:** Tiny Bakery";

describe("classifyFactoryStop", () => {
  it("asks a person when a finished run requests a role", () => {
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: request, phase }),
    ).toBe("human-required");
    expect(
      classifyFactoryStop({
        status: "completed",
        finalMessage: request,
        phase,
      }),
    ).toBe("human-required");
  });

  it("is ready for approval when a finished run has a phase summary", () => {
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: summary, phase }),
    ).toBe("ready-for-approval");
  });

  it("is unverified when a finished run has neither marker", () => {
    expect(
      classifyFactoryStop({
        status: "finished",
        finalMessage: "I think it is done.",
        phase,
      }),
    ).toBe("completed-unverified");
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: null, phase }),
    ).toBe("completed-unverified");
  });

  it("treats an error with a message as recoverable", () => {
    expect(
      classifyFactoryStop({
        status: "errored",
        finalMessage: `${request}\n\nThe build failed.`,
        phase,
      }),
    ).toBe("recoverable-failure");
  });

  it("treats an error without a message as infrastructure", () => {
    expect(
      classifyFactoryStop({ status: "errored", finalMessage: null, phase }),
    ).toBe("infrastructure-error");
    expect(
      classifyFactoryStop({ status: "errored", finalMessage: "  ", phase }),
    ).toBe("infrastructure-error");
  });

  it("abandons a cancelled, expired, or rejected run", () => {
    for (const status of ["cancelled", "expired", "rejected"] as const) {
      expect(
        classifyFactoryStop({ status, finalMessage: request, phase }),
      ).toBe("abandoned");
    }
  });

  it("lets a request beat a phase summary", () => {
    expect(
      classifyFactoryStop({
        status: "finished",
        finalMessage: `${summary}\n\n${request}`,
        phase,
      }),
    ).toBe("human-required");
  });
});
