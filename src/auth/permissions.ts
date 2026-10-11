import type { AdminRoleId } from "@/lib/adminAccess";
import { adminRoleById } from "@/lib/adminAccess";
import type { FactoryPhase } from "@/lib/factoryPhase";

export type ClerkAuthStatus =
  | "unconfigured"
  | "loading"
  | "unavailable"
  | "signed-out"
  | "signed-in";

export function roleHasPermission(
  roleId: AdminRoleId | null,
  permissionId: string,
): boolean {
  if (!roleId) return false;
  return adminRoleById(roleId).permissions.some(
    (permission) => permission.id === permissionId,
  );
}

export function approvalPermissionForPhase(phase: FactoryPhase): string {
  if (phase === "discovery") return "approve-discovery";
  if (phase === "implementation") return "approve-implementation";
  return "approve-delivery";
}

export type ApprovalGate =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Renderer gate for Continue. Missing Clerk keys keep the current ungated
 * buttons. Loading and signed-out states stay closed so privileged actions
 * do not flash. Both main-process approve paths use the same role permission.
 */
export function approvalGate(input: {
  status: ClerkAuthStatus;
  roleId: AdminRoleId | null;
  phase: FactoryPhase;
  /** A private account owns its phases. Organization approval follows the role. */
  accountType?: "user" | "org" | null;
}): ApprovalGate {
  if (input.status === "unconfigured") return { allowed: true };
  if (input.status !== "signed-in") {
    return { allowed: false, reason: "Sign in to approve this phase." };
  }
  if (input.accountType === "user") return { allowed: true };
  if (
    roleHasPermission(input.roleId, approvalPermissionForPhase(input.phase))
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Your role can't approve this phase." };
}

/** Renderer-only. Unconfigured keeps the invite form usable. */
export function canManageMembers(
  status: ClerkAuthStatus,
  canInvite: boolean,
): boolean {
  if (status === "unconfigured") return true;
  if (status !== "signed-in") return false;
  return canInvite;
}

/**
 * Invitations stay with Clerk org:admin. A project manager or developer
 * does not see member management unless that Clerk role is org:admin.
 */
export function canSeeOrganizationAdmin(input: {
  status: ClerkAuthStatus;
  canInvite: boolean;
  accountType: "user" | "org" | null;
}): boolean {
  if (input.status === "unconfigured") return true;
  if (input.status !== "signed-in" || input.accountType !== "org") return false;
  return canManageMembers(input.status, input.canInvite);
}
