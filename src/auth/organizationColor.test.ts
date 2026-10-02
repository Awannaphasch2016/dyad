import { describe, expect, it } from "vitest";
import { organizationColor, organizationInitial } from "./organizationColor";

describe("organization color", () => {
  it("keeps one color for an organization and a fixed color for Private", () => {
    expect(organizationColor("org_anak")).toBe(organizationColor("org_anak"));
    expect(organizationColor(null)).toBe(organizationColor(null));
    expect(organizationColor("org_anak")).not.toBe(organizationColor(null));
    expect(organizationInitial("Anak's Organization")).toBe("A");
    expect(organizationInitial(" private ")).toBe("P");
  });
});
