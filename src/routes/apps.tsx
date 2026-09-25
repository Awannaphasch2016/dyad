import { createRoute } from "@tanstack/react-router";
import { RequireSignedIn } from "@/auth/RequireSignedIn";
import { rootRoute } from "./root";
import AppsPage from "../pages/apps";

function GuardedAppsPage() {
  return (
    <RequireSignedIn>
      <AppsPage />
    </RequireSignedIn>
  );
}

export const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: GuardedAppsPage,
});
