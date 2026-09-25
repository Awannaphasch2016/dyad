import { describe, expect, it } from "vitest";
import { clerkPageView, isClerkAuthPath } from "./clerkPageView";

describe("clerkPageView", () => {
  it("keeps the sign-in widget unmounted until ClerkProvider is ready", () => {
    expect(clerkPageView("loading")).toBe("pending");
    expect(clerkPageView("signed-in")).toBe("pending");
    expect(clerkPageView("signed-out")).toBe("form");
  });

  it("treats sign-in and sign-up, including the Google return, as their own page", () => {
    expect(isClerkAuthPath("/sign-in")).toBe(true);
    expect(isClerkAuthPath("/sign-in/sso-callback")).toBe(true);
    expect(isClerkAuthPath("/sign-up")).toBe(true);
    expect(isClerkAuthPath("/sign-up/verify-email-address")).toBe(true);
    expect(isClerkAuthPath("/")).toBe(false);
    expect(isClerkAuthPath("/chat")).toBe(false);
    expect(isClerkAuthPath("/library")).toBe(false);
  });

  it("surfaces a missing or failed Clerk setup", () => {
    expect(clerkPageView("unconfigured")).toBe("unconfigured");
    expect(clerkPageView("unavailable")).toBe("unavailable");
  });
});
