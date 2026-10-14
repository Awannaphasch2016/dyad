import { describe, expect, it } from "vitest";
import { classifyFactoryStop, phaseSummaryFromFinish } from "./factoryStop";

const phase = "discovery" as const;
const request = "## Request for project-manager\n\nWhich name?";
const summary = "## Discovery summary\n- **Page name:** Tiny Bakery";
const finished = `## Phase finished
- **Page name:** Tiny Bakery
- **One sentence:** A neighborhood bakery.
- **Page contents:** Hero and hours.`;

describe("classifyFactoryStop", () => {
  it("asks a person when a finished run requests a role", () => {
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: request, phase }),
    ).toBe("question_opened");
    expect(
      classifyFactoryStop({
        status: "completed",
        finalMessage: request,
        phase,
      }),
    ).toBe("question_opened");
  });

  it("finishes only on the phase-finished marker", () => {
    expect(
      classifyFactoryStop({
        status: "finished",
        finalMessage: finished,
        phase,
      }),
    ).toBe("agent_finished");
    expect(phaseSummaryFromFinish(phase, finished)).toBe(
      `## Discovery summary
- **Page name:** Tiny Bakery
- **One sentence:** A neighborhood bakery.
- **Page contents:** Hero and hours.`,
    );
  });

  it("does not treat a summary heading as finish", () => {
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: summary, phase }),
    ).toBe("agent_stopped_unclear");
    expect(phaseSummaryFromFinish(phase, summary)).toBeNull();
  });

  it("is unclear when a finished run has neither marker", () => {
    expect(
      classifyFactoryStop({
        status: "finished",
        finalMessage: "I think it is done.",
        phase,
      }),
    ).toBe("agent_stopped_unclear");
    expect(
      classifyFactoryStop({ status: "finished", finalMessage: null, phase }),
    ).toBe("agent_stopped_unclear");
  });

  it("treats an error as a failure even when the text asks a question", () => {
    expect(
      classifyFactoryStop({
        status: "errored",
        finalMessage: `${request}\n\nThe build failed.`,
        phase,
      }),
    ).toBe("agent_failed");
    expect(
      classifyFactoryStop({ status: "errored", finalMessage: null, phase }),
    ).toBe("agent_failed");
    expect(
      classifyFactoryStop({ status: "errored", finalMessage: "  ", phase }),
    ).toBe("agent_failed");
  });

  it("treats a cancelled, expired, or rejected run as unclear", () => {
    for (const status of ["cancelled", "expired", "rejected"] as const) {
      expect(
        classifyFactoryStop({ status, finalMessage: request, phase }),
      ).toBe("agent_stopped_unclear");
    }
  });

  it("lets a request beat a finish marker", () => {
    expect(
      classifyFactoryStop({
        status: "finished",
        finalMessage: `${finished}\n\n${request}`,
        phase,
      }),
    ).toBe("question_opened");
  });
});
