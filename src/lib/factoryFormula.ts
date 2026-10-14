import type { FactoryPhase } from "@/lib/factoryPhase";

/** The formula Dyad slings for a factory app. GasCity compiles this graph. */
export const FACTORY_FORMULA = "speckit-phased";

export interface FormulaStep {
  id: string;
  phase: FactoryPhase;
  title: string;
  gate: boolean;
}

/**
 * speckit-phased order from the methodology pack. Dyad does not run these
 * steps. It only reads which bead is open.
 */
export const FACTORY_FORMULA_STEPS: readonly FormulaStep[] = [
  { id: "requirements", phase: "discovery", title: "Specify", gate: false },
  { id: "clarify", phase: "discovery", title: "Clarify", gate: false },
  { id: "plan", phase: "discovery", title: "Plan", gate: false },
  {
    id: "plan-review",
    phase: "discovery",
    title: "Record the plan",
    gate: false,
  },
  { id: "decompose", phase: "discovery", title: "Tasks", gate: false },
  {
    id: "accept-discovery",
    phase: "discovery",
    title: "Discovery gate",
    gate: true,
  },
  {
    id: "implement",
    phase: "implementation",
    title: "Implement",
    gate: false,
  },
  {
    id: "implement-same-session",
    phase: "implementation",
    title: "Implement",
    gate: false,
  },
  { id: "review", phase: "implementation", title: "Converge", gate: false },
  {
    id: "accept-implementation",
    phase: "implementation",
    title: "Implementation gate",
    gate: true,
  },
  { id: "finalize", phase: "delivery", title: "Final report", gate: false },
  {
    id: "accept-delivery",
    phase: "delivery",
    title: "Delivery gate",
    gate: true,
  },
  { id: "publish", phase: "delivery", title: "Publish", gate: false },
];

const BY_ID = new Map(FACTORY_FORMULA_STEPS.map((step) => [step.id, step]));

export function formulaStep(
  stepId: string | null | undefined,
): FormulaStep | null {
  if (!stepId) return null;
  return BY_ID.get(stepId) ?? null;
}

export function formulaStepIndex(stepId: string | null | undefined): number {
  if (!stepId) return -1;
  return FACTORY_FORMULA_STEPS.findIndex((step) => step.id === stepId);
}

/** Phases before the open bead. Delivery closes only after publish completes. */
export function closedFormulaPhases(
  stepId: string | null | undefined,
  status?: string | null,
): FactoryPhase[] {
  const step = formulaStep(stepId);
  if (!step) return [];
  const order: FactoryPhase[] = ["discovery", "implementation", "delivery"];
  const closed = order.slice(0, order.indexOf(step.phase));
  if (status === "completed" && step.id === "publish") closed.push("delivery");
  return closed;
}
