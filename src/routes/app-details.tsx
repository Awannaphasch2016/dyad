import { createRoute } from "@tanstack/react-router";
import { RequireSignedIn } from "@/auth/RequireSignedIn";
import { rootRoute } from "./root";
import AppDetailsPage from "../pages/app-details";
import { appDetailsSearchSchema } from "./appDetailsSearchSchema";

function GuardedAppDetailsPage() {
  return (
    <RequireSignedIn>
      <AppDetailsPage />
    </RequireSignedIn>
  );
}

export const appDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-details",
  component: GuardedAppDetailsPage,
  validateSearch: appDetailsSearchSchema,
});
