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

/** Discovery and Delivery stay read-only. Implementation is the build chat. */
export function factoryPhaseChatMode(phase: FactoryPhase): "ask" | "build" {
  return phase === "implementation" ? "build" : "ask";
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

/** The phase chats in Discovery → Implementation → Delivery order. */
export function orderedFactoryPhaseChats<T extends { title: string | null }>(
  chats: T[],
): T[] {
  const found = factoryPhaseChats(chats);
  return FACTORY_PHASES.flatMap((phase) => {
    const chat = found[phase];
    return chat ? [chat] : [];
  });
}

export function hasFactoryPhases<T extends { title: string | null }>(
  chats: T[],
): boolean {
  const found = factoryPhaseChats(chats);
  return FACTORY_PHASES.every((phase) => found[phase] != null);
}

export function factoryPhaseHint(phase: FactoryPhase): string {
  if (phase === "discovery") {
    return "wewebplus asks about the page name, one sentence, and what goes on the page. Approve once its Discovery summary looks right.";
  }
  if (phase === "implementation") {
    return "Send the prefilled summary to start the build, then review the preview. Approve once the page looks right.";
  }
  return "wewebplus summarizes what was built. Approve delivery when the trial is finished.";
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

/**
 * The approve control belongs to the phase that is still in progress.
 * It is gone once that phase was approved, a later phase has started, or
 * Delivery has posted its summary and the run is finished.
 */
export function showFactoryPhaseApproval({
  phase,
  progress,
  hasPhaseSummary,
}: {
  phase: FactoryPhase;
  progress: FactoryPhaseProgress;
  hasPhaseSummary: boolean;
}): boolean {
  if (isFactoryPhaseApproved(phase, progress)) return false;
  if (phase === "delivery" && hasPhaseSummary) return false;
  return true;
}

export type FactoryPhaseShade = "not-started" | "in-progress" | "finished";

/**
 * All three phase buttons use one color. A phase that has started and is not
 * finished yet is the lighter shade. A finished phase is the solid shade.
 */
export function factoryPhaseShade({
  phase,
  progress,
  hasPhaseSummary,
}: {
  phase: FactoryPhase;
  progress: FactoryPhaseProgress;
  hasPhaseSummary: boolean;
}): FactoryPhaseShade {
  if (
    isFactoryPhaseApproved(phase, progress) ||
    (phase === "delivery" && hasPhaseSummary)
  ) {
    return "finished";
  }
  if (progress.started.has(phase)) return "in-progress";
  return "not-started";
}

/** Approval needs Dyad's finished phase summary; an ordinary reply is not enough. */
export function canContinueFactoryPhase({
  hasPhaseSummary,
  isStreaming,
}: {
  hasPhaseSummary: boolean;
  isStreaming: boolean;
}): boolean {
  return hasPhaseSummary && !isStreaming;
}

export function factoryPhaseSummaryHeading(phase: FactoryPhase): string {
  return `${factoryPhaseLabel(phase)} summary`;
}

/**
 * Returns the bullet list under Dyad's "## <Phase> summary" heading, or null
 * when the message has no complete summary for that phase.
 */
export function extractFactoryPhaseSummary(
  content: string,
  phase: FactoryPhase,
): string | null {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const lines = withoutThinking.split(/\r?\n/);
  const heading = factoryPhaseSummaryHeading(phase).toLowerCase();
  const start = lines.findIndex((line) => {
    const match = /^\s*#{1,4}\s*(.+?)\s*$/.exec(line);
    return (
      match != null &&
      match[1].replace(/\*/g, "").replace(/:\s*$/, "").trim().toLowerCase() ===
        heading
    );
  });
  if (start === -1) return null;
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      bullets.push(line.trimEnd());
      continue;
    }
    if (line.trim() === "") {
      if (bullets.length > 0) break;
      continue;
    }
    if (bullets.length > 0 && /^\s{2,}\S/.test(line)) {
      bullets.push(line.trimEnd());
      continue;
    }
    break;
  }
  return bullets.length > 0 ? bullets.join("\n") : null;
}

/** The latest phase summary Dyad wrote in this chat, if the last reply has one. */
export function latestFactoryPhaseSummary(
  messages: readonly { role: string; content: string }[],
  phase: FactoryPhase,
): string | null {
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  return lastAssistant
    ? extractFactoryPhaseSummary(lastAssistant.content, phase)
    : null;
}

/** Discovery and Delivery start with Dyad's turn; Implementation waits for the person to send. */
export function factoryPhaseKickoff(
  phase: FactoryPhase,
  previousSummary: string | null,
): string | null {
  if (phase === "discovery") return "Start Discovery.";
  if (phase === "delivery") {
    return previousSummary
      ? `Start Delivery. Approved implementation summary:\n\n${previousSummary}`
      : "Start Delivery.";
  }
  return null;
}

export function lockedFactoryPhaseReason(phase: FactoryPhase): string {
  const index = FACTORY_PHASES.indexOf(phase);
  const previous = FACTORY_PHASES[index - 1];
  return previous
    ? `Approve ${factoryPhaseLabel(previous)} first`
    : "Not available yet";
}

/** Prefill for the next chat. Implementation carries the approved Discovery summary. */
export function continuePrefill(
  phase: FactoryPhase,
  previousSummary?: string | null,
): string | undefined {
  if (phase === "implementation") {
    return previousSummary
      ? `Build the one-page site from this approved Discovery summary:\n\n${previousSummary}`
      : "Build the one-page site from what I approved in Discovery.";
  }
  return undefined;
}

/** Factory chats hide the generic "Keep going" suggestion. */
export function visibleComposerActions<T extends { id: string }>(
  actions: readonly T[],
  factory: boolean,
): T[] {
  if (!factory) return [...actions];
  return actions.filter((action) => action.id !== "keep-going");
}

/** Factory phase chats hide Undo and Retry under the transcript. */
export function showMessageRevisionActions(factory: boolean): boolean {
  return !factory;
}
