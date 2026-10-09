import { describe, expect, it } from "vitest";
import { extractFactoryRequest } from "./factoryRequest";

describe("extractFactoryRequest", () => {
  it("reads a request for a factory role", () => {
    expect(
      extractFactoryRequest(
        "## Request for project-manager\n\nWhich name should the page use?",
      ),
    ).toEqual({
      role: "project-manager",
      body: "Which name should the page use?",
    });
  });

  it("returns null when the message has no request", () => {
    expect(extractFactoryRequest("The page is ready.")).toBeNull();
    expect(
      extractFactoryRequest(
        "<think>## Request for developer\nShip it?</think>Done.",
      ),
    ).toBeNull();
  });

  it("returns null for a role the factory does not have", () => {
    expect(
      extractFactoryRequest("## Request for reviewer\n\nApprove this?"),
    ).toBeNull();
  });

  it("keeps the last request when a message has two", () => {
    expect(
      extractFactoryRequest(
        [
          "## Request for developer",
          "Is the layout acceptable?",
          "",
          "## Request for project-manager",
          "Which name should the page use?",
        ].join("\n"),
      ),
    ).toEqual({
      role: "project-manager",
      body: "Which name should the page use?",
    });
  });

  it("ignores a request that only appears inside a code fence", () => {
    expect(
      extractFactoryRequest(
        [
          "```",
          "## Request for developer",
          "Ignore this example.",
          "```",
          "## Request for project-manager",
          "Which name should the page use?",
        ].join("\n"),
      ),
    ).toEqual({
      role: "project-manager",
      body: "Which name should the page use?",
    });
    expect(
      extractFactoryRequest(
        ["```", "## Request for developer", "Ignore this.", "```"].join("\n"),
      ),
    ).toBeNull();
  });
});
