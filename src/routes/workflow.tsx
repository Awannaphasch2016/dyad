import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RequireSignedIn } from "@/auth/RequireSignedIn";
import { rootRoute } from "./root";
import WorkflowPage from "../pages/workflow";

export const workflowSearchSchema = z.object({
  appId: z.number().optional(),
});

function GuardedWorkflowPage() {
  return (
    <RequireSignedIn>
      <WorkflowPage />
    </RequireSignedIn>
  );
}

export const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflow",
  component: GuardedWorkflowPage,
  validateSearch: workflowSearchSchema,
});
