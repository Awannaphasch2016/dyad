export const FACTORY_PHASES = [
  "discovery",
  "implementation",
  "delivery",
] as const;

export type FactoryPhase = (typeof FACTORY_PHASES)[number];

const TITLE_TO_PHASE: Record<string, FactoryPhase> = {
  Discovery: "discovery",
  Implementation: "implementation",
  Delivery: "delivery",
};

export function phaseFromTitle(
  title: string | null | undefined,
): FactoryPhase | null {
  if (!title) return null;
  return TITLE_TO_PHASE[title] ?? null;
}

export function factoryPhaseLabel(phase: FactoryPhase): string {
  if (phase === "discovery") return "Discovery";
  if (phase === "implementation") return "Implementation";
  return "Delivery";
}

/** The website preview belongs to the implementation chat only. */
export function previewOpenForPhase(phase: FactoryPhase): boolean {
  return phase === "implementation";
}

export function nextFactoryPhase(phase: FactoryPhase): FactoryPhase | null {
  const next = FACTORY_PHASES[FACTORY_PHASES.indexOf(phase) + 1];
  return next ?? null;
}

export function factoryPhaseChats<T extends { title: string | null }>(
  chats: T[],
): Partial<Record<FactoryPhase, T>> {
  const found: Partial<Record<FactoryPhase, T>> = {};
  for (const chat of chats) {
    const phase = phaseFromTitle(chat.title);
    if (phase && !found[phase]) found[phase] = chat;
  }
  return found;
}

export function hasFactoryPhases<T extends { title: string | null }>(
  chats: T[],
): boolean {
  const found = factoryPhaseChats(chats);
  return FACTORY_PHASES.every((phase) => found[phase] != null);
}

export function factoryPhaseHint(phase: FactoryPhase): string {
  if (phase === "discovery") {
    return "Answer with the page name, one sentence, and what should be on the page. Continue only when you approve building.";
  }
  if (phase === "implementation") {
    return "The preview is the page being built. Say what to change here. Continue only when you approve it.";
  }
  return "This chat is delivery. The page was already previewed during implementation. Approve here when the trial is finished.";
}

export function continuePrefill(phase: FactoryPhase): string | undefined {
  if (phase === "implementation") {
    return "Build the one-page site from what I approved in Discovery.";
  }
  if (phase === "delivery") {
    return "The one-pager is ready. Summarize the page for delivery.";
  }
  return undefined;
}
