export const FORMULA_PHASES = [
  "discovery",
  "implementation",
  "delivery",
] as const;

export type FormulaPhase = (typeof FORMULA_PHASES)[number];

const PHASE_LABEL: Record<FormulaPhase, string> = {
  discovery: "Discovery",
  implementation: "Implementation",
  delivery: "Delivery",
};

const STARTER_STEP: Record<
  FormulaPhase,
  { id: string; title: string; description: string }
> = {
  discovery: {
    id: "discover",
    title: "Discover",
    description: "Explore the request.",
  },
  implementation: {
    id: "implement",
    title: "Implement",
    description: "Carry out the approved plan.",
  },
  delivery: {
    id: "deliver",
    title: "Deliver",
    description: "Hand off the finished work.",
  },
};

export function isFormulaPhase(value: string): value is FormulaPhase {
  return (FORMULA_PHASES as readonly string[]).includes(value);
}

export function formulaPhaseLabel(phase: FormulaPhase): string {
  return PHASE_LABEL[phase];
}

/** Shown when the city has no file yet. It is not written until the user saves. */
export function starterFormula(phase: FormulaPhase): string {
  const step = STARTER_STEP[phase];
  return `formula = "${phase}"
description = "${PHASE_LABEL[phase]}"

[requires]
formula_compiler = ">=2.0.0"

[[steps]]
id = "${step.id}"
title = "${step.title}"
description = "${step.description}"
`;
}
