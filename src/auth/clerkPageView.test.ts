import { describe, expect, it } from "vitest";
import { clerkPageView } from "./clerkPageView";

describe("clerkPageView", () => {
  it("keeps the sign-in widget unmounted until ClerkProvider is ready", () => {
    expect(clerkPageView("loading")).toBe("pending");
    expect(clerkPageView("signed-in")).toBe("pending");
    expect(clerkPageView("signed-out")).toBe("form");
  });

  it("surfaces a missing or failed Clerk setup", () => {
    expect(clerkPageView("unconfigured")).toBe("unconfigured");
    expect(clerkPageView("unavailable")).toBe("unavailable");
  });
});
