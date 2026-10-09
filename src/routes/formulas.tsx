import { createRoute, redirect } from "@tanstack/react-router";
import { FormulaPage } from "@/pages/formula";
import { isFormulaPhase } from "@/lib/formula/phases";
import { rootRoute } from "./root";

export const formulasIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/formulas",
  beforeLoad: () => {
    throw redirect({
      to: "/formulas/$phase",
      params: { phase: "discovery" },
    });
  },
});

export const formulasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/formulas/$phase",
  beforeLoad: ({ params }) => {
    if (!isFormulaPhase(params.phase)) {
      throw redirect({
        to: "/formulas/$phase",
        params: { phase: "discovery" },
      });
    }
  },
  component: function FormulaRoute() {
    const { phase } = formulasRoute.useParams();
    if (!isFormulaPhase(phase)) return null;
    return <FormulaPage key={phase} phase={phase} />;
  },
});
