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

export interface FactoryPhaseProgress {
  /** Phases the person approved by pressing Continue. */
  approved: ReadonlySet<FactoryPhase>;
  /** Phases whose chat already has at least one message. */
  started: ReadonlySet<FactoryPhase>;
}

/**
 * A phase counts as approved once the person pressed Continue on it, or once
 * the following phase's chat has messages (which only happens after Continue).
 */
export function isFactoryPhaseApproved(
  phase: FactoryPhase,
  progress: FactoryPhaseProgress,
): boolean {
  if (progress.approved.has(phase)) return true;
  const next = nextFactoryPhase(phase);
  return next != null && progress.started.has(next);
}

/** Discovery is always open; each later phase opens when the one before it is approved. */
export function isFactoryPhaseUnlocked(
  phase: FactoryPhase,
  progress: FactoryPhaseProgress,
): boolean {
  const index = FACTORY_PHASES.indexOf(phase);
  if (index <= 0) return true;
  const previous = FACTORY_PHASES[index - 1];
  return (
    isFactoryPhaseUnlocked(previous, progress) &&
    isFactoryPhaseApproved(previous, progress)
  );
}

export function latestUnlockedFactoryPhase(
  progress: FactoryPhaseProgress,
): FactoryPhase {
  let latest: FactoryPhase = FACTORY_PHASES[0];
  for (const phase of FACTORY_PHASES) {
    if (!isFactoryPhaseUnlocked(phase, progress)) break;
    latest = phase;
  }
  return latest;
}

/** Continue needs a finished assistant reply in the current phase to approve. */
export function canContinueFactoryPhase({
  hasAssistantReply,
  isStreaming,
}: {
  hasAssistantReply: boolean;
  isStreaming: boolean;
}): boolean {
  return hasAssistantReply && !isStreaming;
}

export function lockedFactoryPhaseReason(phase: FactoryPhase): string {
  const index = FACTORY_PHASES.indexOf(phase);
  const previous = FACTORY_PHASES[index - 1];
  return previous
    ? `Approve ${factoryPhaseLabel(previous)} first`
    : "Not available yet";
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
