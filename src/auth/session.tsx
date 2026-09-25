import { createContext, useContext, type ReactNode } from "react";
import type { AdminRoleId } from "@/lib/adminAccess";
import { roleHasPermission, type ClerkAuthStatus } from "./permissions";

export type ClerkSessionState =
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      roleId: AdminRoleId;
      userId: string;
      email: string | null;
    };

const ClerkSessionContext = createContext<ClerkSessionState>({
  status: "unconfigured",
});

export function ClerkSessionProvider({
  value,
  children,
}: {
  value: ClerkSessionState;
  children: ReactNode;
}) {
  return (
    <ClerkSessionContext.Provider value={value}>
      {children}
    </ClerkSessionContext.Provider>
  );
}

export function useClerkSession(): ClerkSessionState {
  return useContext(ClerkSessionContext);
}

/**
 * Role from Clerk public metadata, bridged into context so callers never
 * call Clerk hooks outside ClerkProvider.
 */
export function useClerkRole(): {
  status: ClerkAuthStatus;
  roleId: AdminRoleId | null;
  email: string | null;
  can: (permissionId: string) => boolean;
} {
  const session = useClerkSession();
  if (session.status !== "signed-in") {
    return {
      status: session.status,
      roleId: null,
      email: null,
      can: () => session.status === "unconfigured",
    };
  }
  return {
    status: session.status,
    roleId: session.roleId,
    email: session.email,
    can: (permissionId) => roleHasPermission(session.roleId, permissionId),
  };
}
