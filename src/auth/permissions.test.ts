import { describe, expect, it } from "vitest";
import {
  approvalGate,
  canManageMembers,
  roleHasPermission,
} from "./permissions";

describe("clerk role gates", () => {
  it("maps factory approvals onto role permissions", () => {
    expect(roleHasPermission("admin", "approve-discovery")).toBe(true);
    expect(roleHasPermission("reviewer", "approve-delivery")).toBe(true);
    expect(roleHasPermission("dev", "approve-implementation")).toBe(false);
    expect(roleHasPermission("dev", "work-implementation")).toBe(true);
    expect(roleHasPermission("admin", "manage-members")).toBe(true);
    expect(roleHasPermission("reviewer", "manage-members")).toBe(false);
  });

  it("keeps approvals open only when Clerk is unconfigured or the role allows them", () => {
    expect(
      approvalGate({
        status: "unconfigured",
        roleId: null,
        phase: "discovery",
      }),
    ).toEqual({ allowed: true });
    expect(
      approvalGate({ status: "loading", roleId: null, phase: "discovery" }),
    ).toEqual({ allowed: false, reason: "Sign in to approve this phase." });
    expect(
      approvalGate({
        status: "signed-in",
        roleId: "dev",
        phase: "implementation",
      }),
    ).toEqual({
      allowed: false,
      reason: "Your role can't approve this phase.",
    });
    expect(
      approvalGate({
        status: "signed-in",
        roleId: "reviewer",
        phase: "delivery",
      }),
    ).toEqual({ allowed: true });
  });

  it("lets only admins manage members once Clerk is configured", () => {
    expect(canManageMembers("unconfigured", null)).toBe(true);
    expect(canManageMembers("loading", null)).toBe(false);
    expect(canManageMembers("signed-in", "reviewer")).toBe(false);
    expect(canManageMembers("signed-in", "admin")).toBe(true);
  });
});
