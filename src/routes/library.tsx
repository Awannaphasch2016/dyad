import { useNavigate, Route } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { canSeeOrganizationAdmin } from "@/auth/permissions";
import { RequireSignedIn } from "@/auth/RequireSignedIn";
import { useClerkSession } from "@/auth/session";
import { rootRoute } from "./root";
import AdminAccessPage from "@/pages/admin-access";

function RequireOrganizationAdmin({ children }: { children: ReactNode }) {
  const session = useClerkSession();
  const navigate = useNavigate();
  const allowed = canSeeOrganizationAdmin(
    session.status === "signed-in"
      ? {
          status: "signed-in",
          roleId: session.roleId,
          accountType: session.account?.type ?? null,
        }
      : { status: session.status, roleId: null, accountType: null },
  );

  useEffect(() => {
    if (session.status !== "signed-in" || allowed) return;
    void navigate({ to: "/", replace: true });
  }, [allowed, navigate, session.status]);

  if (session.status === "signed-in" && !allowed) return null;
  return children;
}

function GuardedAdminAccessPage() {
  return (
    <RequireSignedIn>
      <RequireOrganizationAdmin>
        <AdminAccessPage />
      </RequireOrganizationAdmin>
    </RequireSignedIn>
  );
}

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: GuardedAdminAccessPage,
});
