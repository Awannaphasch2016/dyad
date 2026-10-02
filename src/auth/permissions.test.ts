import { describe, expect, it } from "vitest";
import {
  approvalGate,
  canManageMembers,
  canSeeOrganizationAdmin,
  roleHasPermission,
} from "./permissions";

describe("clerk role gates", () => {
  it("maps factory approvals onto role permissions", () => {
    expect(roleHasPermission("project-manager", "approve-discovery")).toBe(
      true,
    );
    expect(roleHasPermission("project-manager", "approve-delivery")).toBe(true);
    expect(roleHasPermission("developer", "approve-implementation")).toBe(
      false,
    );
    expect(roleHasPermission("developer", "work-implementation")).toBe(true);
    expect(roleHasPermission("project-manager", "manage-members")).toBe(false);
    expect(roleHasPermission(null, "approve-discovery")).toBe(false);
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
        roleId: "developer",
        phase: "implementation",
      }),
    ).toEqual({
      allowed: false,
      reason: "Your role can't approve this phase.",
    });
    expect(
      approvalGate({
        status: "signed-in",
        roleId: "project-manager",
        phase: "delivery",
      }),
    ).toEqual({ allowed: true });
  });

  it("lets only admins manage members once Clerk is configured", () => {
    expect(canManageMembers("unconfigured", false)).toBe(true);
    expect(canManageMembers("loading", false)).toBe(false);
    expect(canManageMembers("signed-in", false)).toBe(false);
    expect(canManageMembers("signed-in", true)).toBe(true);
  });

  it("shows Admin only to an admin of the active organization", () => {
    expect(
      canSeeOrganizationAdmin({
        status: "unconfigured",
        canInvite: false,
        accountType: null,
      }),
    ).toBe(true);
    expect(
      canSeeOrganizationAdmin({
        status: "signed-in",
        canInvite: true,
        accountType: "org",
      }),
    ).toBe(true);
    expect(
      canSeeOrganizationAdmin({
        status: "signed-in",
        canInvite: true,
        accountType: "user",
      }),
    ).toBe(false);
    expect(
      canSeeOrganizationAdmin({
        status: "signed-in",
        canInvite: false,
        accountType: "org",
      }),
    ).toBe(false);
    expect(
      canSeeOrganizationAdmin({
        status: "signed-in",
        canInvite: false,
        accountType: "org",
      }),
    ).toBe(false);
  });
});
