import { Route } from "@tanstack/react-router";
import { RequireSignedIn } from "@/auth/RequireSignedIn";
import { rootRoute } from "./root";
import AdminAccessPage from "@/pages/admin-access";

function GuardedAdminAccessPage() {
  return (
    <RequireSignedIn>
      <AdminAccessPage />
    </RequireSignedIn>
  );
}

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: GuardedAdminAccessPage,
});
