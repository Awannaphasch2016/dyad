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
  roleId: AdminRoleId,
  permissionId: string,
): boolean {
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
 * Renderer-only gate. Missing Clerk keys keep the current ungated buttons.
 * Loading and signed-out states stay closed so privileged actions do not flash.
 * Main does not yet verify the Clerk session for these actions.
 */
export function approvalGate(input: {
  status: ClerkAuthStatus;
  roleId: AdminRoleId | null;
  phase: FactoryPhase;
}): ApprovalGate {
  if (input.status === "unconfigured") return { allowed: true };
  if (input.status !== "signed-in" || input.roleId == null) {
    return { allowed: false, reason: "Sign in to approve this phase." };
  }
  if (
    roleHasPermission(input.roleId, approvalPermissionForPhase(input.phase))
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Your role can't approve this phase." };
}

/** Renderer-only. Unconfigured keeps the Admin invite form usable. */
export function canManageMembers(
  status: ClerkAuthStatus,
  roleId: AdminRoleId | null,
): boolean {
  if (status === "unconfigured") return true;
  if (status !== "signed-in" || roleId == null) return false;
  return roleHasPermission(roleId, "manage-members");
}
