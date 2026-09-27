import { describe, expect, it } from "vitest";
import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirect("/chat")).toBe("/chat");
    expect(safeRedirect("/chat?id=1")).toBe("/chat?id=1");
    expect(safeRedirect("/library")).toBe("/library");
  });

  it("sends everything else home", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect("https://evil.example/phish")).toBe("/");
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
    expect(safeRedirect("chat")).toBe("/");
  });
});
