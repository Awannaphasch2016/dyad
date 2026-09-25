import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClerkSessionProvider, useClerkRole } from "./session";

describe("useClerkRole", () => {
  it("stays closed while the session is loading", () => {
    const { result } = renderHook(() => useClerkRole(), {
      wrapper: ({ children }) => (
        <ClerkSessionProvider value={{ status: "loading" }}>
          {children}
        </ClerkSessionProvider>
      ),
    });
    expect(result.current.can("approve-discovery")).toBe(false);
    expect(result.current.roleId).toBeNull();
  });

  it("reads the signed-in role from session context", () => {
    const { result } = renderHook(() => useClerkRole(), {
      wrapper: ({ children }) => (
        <ClerkSessionProvider
          value={{
            status: "signed-in",
            roleId: "dev",
            userId: "user_1",
            email: "dev@example.com",
          }}
        >
          {children}
        </ClerkSessionProvider>
      ),
    });
    expect(result.current.roleId).toBe("dev");
    expect(result.current.can("work-implementation")).toBe(true);
    expect(result.current.can("manage-members")).toBe(false);
  });

  it("keeps every permission when Clerk is not configured", () => {
    const { result } = renderHook(() => useClerkRole(), {
      wrapper: ({ children }) => (
        <ClerkSessionProvider value={{ status: "unconfigured" }}>
          {children}
        </ClerkSessionProvider>
      ),
    });
    expect(result.current.can("manage-members")).toBe(true);
  });
});
