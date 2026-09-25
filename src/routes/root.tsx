import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ClerkAuthProvider } from "../auth/ClerkAuthProvider";
import Layout from "../app/layout";
import { useNotificationHandler } from "../hooks/useNotificationHandler";

export const rootRoute = createRootRoute({
  component: () => {
    useNotificationHandler();
    return (
      <ClerkAuthProvider>
        <Layout>
          <Outlet />
        </Layout>
      </ClerkAuthProvider>
    );
  },
});
