import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AdminAccessPage from "@/pages/admin-access";

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: AdminAccessPage,
});
