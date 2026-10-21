import { describe, expect, it } from "vitest";
import {
  designTurn,
  figmaAccess,
  figmaConnection,
  parseFigmaLink,
} from "./design";

describe("parseFigmaLink", () => {
  it("reads a design URL and turns hyphen node ids into colons", () => {
    expect(
      parseFigmaLink(
        "https://www.figma.com/design/AbCdEf123456/Home?node-id=1-3&t=abc",
      ),
    ).toMatchObject({
      fileKey: "AbCdEf123456",
      nodeId: "1:3",
    });
  });

  it("accepts a file URL with no node", () => {
    expect(
      parseFigmaLink("https://figma.com/file/AbCdEf123456/Home"),
    ).toMatchObject({
      fileKey: "AbCdEf123456",
      nodeId: null,
    });
  });

  it("rejects a page that is not a Figma file", () => {
    expect(
      parseFigmaLink("https://example.com/design/AbCdEf123456"),
    ).toBeNull();
    expect(parseFigmaLink("not a url")).toBeNull();
  });
});

describe("figmaConnection", () => {
  const server = {
    id: 4,
    name: "Figma",
    url: "https://mcp.figma.com/mcp",
    enabled: true,
    catalogSlug: "figma",
    oauthEnabled: true,
    oauthConnected: false,
  };

  it("reports a missing server", () => {
    expect(figmaConnection([])).toEqual({ state: "missing" });
  });

  it("asks for sign-in until OAuth is connected", () => {
    expect(figmaConnection([server])).toEqual({
      state: "needs-auth",
      serverId: 4,
    });
    expect(figmaConnection([{ ...server, oauthConnected: true }])).toEqual({
      state: "connected",
      serverId: 4,
    });
  });

  it("treats a turned-off server as disabled", () => {
    expect(figmaConnection([{ ...server, enabled: false }])).toEqual({
      state: "disabled",
      serverId: 4,
    });
  });
});

describe("figmaAccess", () => {
  const remote = {
    id: 4,
    name: "Figma",
    url: "https://mcp.figma.com/mcp",
    enabled: true,
    catalogSlug: "figma",
    oauthEnabled: true,
    oauthConnected: false,
  };
  const desktop = {
    id: 8,
    name: "Figma desktop",
    url: "http://127.0.0.1:3845/mcp",
    enabled: true,
    catalogSlug: null,
    oauthEnabled: false,
    oauthConnected: false,
  };

  it("keeps generate closed when the remote server still needs sign-in", () => {
    expect(figmaAccess([remote], {})).toMatchObject({
      canGenerate: false,
      canImport: false,
    });
  });

  it("lets a live desktop server build from a link", () => {
    expect(figmaAccess([remote, desktop], { 8: "ok" })).toMatchObject({
      canGenerate: false,
      canImport: true,
    });
  });

  it("does not treat a saved desktop server as usable until its tools answer", () => {
    expect(figmaAccess([desktop], { 8: "error" })).toMatchObject({
      canGenerate: false,
      canImport: false,
      desktop: { state: "connected", serverId: 8 },
    });
  });
});

describe("designTurn", () => {
  it("asks the agent to create the design in Figma via sandbox MCP hosts", () => {
    const text = designTurn({
      intent: "generate",
      prompt: "A settings screen",
      link: null,
    });
    expect(text).toContain("use_figma");
    expect(text).toContain("execute_sandbox_script");
    expect(text).toContain("A settings screen");
    expect(text).not.toMatch(/^Use the Figma MCP tool use_figma/m);
  });

  it("hands a parsed link to the existing file writer via sandbox MCP hosts", () => {
    const text = designTurn({
      intent: "import",
      prompt: "Match the spacing",
      link: {
        fileKey: "AbCdEf123456",
        nodeId: "1:3",
        url: "https://www.figma.com/design/AbCdEf123456/Home?node-id=1-3",
      },
    });
    expect(text).toContain("AbCdEf123456");
    expect(text).toContain("node 1:3");
    expect(text).toContain("write_file");
    expect(text).toContain("execute_sandbox_script");
    expect(text).toContain("get_metadata");
    expect(text).toContain("Match the spacing");
    expect(text).toContain("Do not call them as top-level tools");
  });
});
