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
  chats: readonly T[],
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
  chats: readonly T[],
): boolean {
  const found = factoryPhaseChats(chats);
  return FACTORY_PHASES.every((phase) => found[phase] != null);
}

/** Every web builder has Discovery, Implementation, and Delivery. */
export function appIdsMissingFactoryPhases(
  appIds: readonly number[],
  chats: readonly { appId: number; title: string | null }[],
): number[] {
  const byApp = new Map<number, { title: string | null }[]>();
  for (const appId of appIds) byApp.set(appId, []);
  for (const chat of chats) {
    const rows = byApp.get(chat.appId);
    if (rows) rows.push(chat);
  }
  return appIds.filter((appId) => !hasFactoryPhases(byApp.get(appId) ?? []));
}

export function factoryPhaseHint(phase: FactoryPhase): string {
  if (phase === "discovery") {
    return "wewebplus asks about the page name, one sentence, and what goes on the page. Approve once its Discovery summary looks right.";
  }
  if (phase === "implementation") {
    return "The developer reviews the build after the summary is written. Approve once the page looks right.";
  }
  return "wewebplus writes the delivery summary after the recap finishes. Approve delivery when that summary looks right.";
}

export function factoryPhaseApproverLabel(phase: FactoryPhase): string {
  return phase === "implementation" ? "Developer" : "Project Manager";
}

/** Status line for the phase bar. The snapshot status is the source. */
export function factoryPhaseStatusLine(input: {
  phase: FactoryPhase;
  status: string;
  viewerCanApprove: boolean;
}): string {
  const label = factoryPhaseLabel(input.phase);
  switch (input.status) {
    case "locked":
      return `Starting ${label}.`;
    case "executing":
      return `Working in ${label}.`;
    case "waiting_for_answer":
      return `Waiting on an answer in ${label}.`;
    case "running_hooks":
      return `Writing the ${label} summary.`;
    case "awaiting_review":
      return input.viewerCanApprove
        ? `Review the ${label} summary.`
        : `Waiting on ${factoryPhaseApproverLabel(input.phase)} to approve ${label}.`;
    case "approved":
      return `${label} is approved.`;
    case "incomplete":
      return "Stopped before it finished. No question is open.";
    case "failed":
      return "The run failed.";
    default:
      return factoryPhaseHint(input.phase);
  }
}

export interface FactoryPhaseProgress {
  /** Phases the person approved by pressing Continue. */
  approved: ReadonlySet<FactoryPhase>;
  /** Phases whose chat already has at least one message. */
  started: ReadonlySet<FactoryPhase>;
}

/** A phase is approved only when its approval record exists. */
export function isFactoryPhaseApproved(
  phase: FactoryPhase,
  progress: FactoryPhaseProgress,
): boolean {
  return progress.approved.has(phase);
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
 * Approve and reject belong to a phase that is waiting for review.
 * A summary heading does not show them, and approving hides them.
 */
export function showFactoryPhaseApproval({
  phase,
  progress,
  status,
}: {
  phase: FactoryPhase;
  progress: FactoryPhaseProgress;
  status: string | null;
}): boolean {
  if (isFactoryPhaseApproved(phase, progress)) return false;
  return status === "awaiting_review";
}

export type FactoryPhaseShade = "not-started" | "in-progress" | "finished";

/**
 * All three phase buttons use one color. A phase that has started and is not
 * finished yet is the lighter shade. A finished phase is the solid shade.
 */
export function factoryPhaseShade({
  phase,
  progress,
}: {
  phase: FactoryPhase;
  progress: FactoryPhaseProgress;
}): FactoryPhaseShade {
  if (isFactoryPhaseApproved(phase, progress)) return "finished";
  if (progress.started.has(phase)) return "in-progress";
  return "not-started";
}

/** Approval is enabled only while the phase is in review and the agent is idle. */
export function canContinueFactoryPhase({
  status,
  isStreaming,
}: {
  status: string | null;
  isStreaming: boolean;
}): boolean {
  return status === "awaiting_review" && !isStreaming;
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

/** How often a window rereads the factory app it is showing. */
export const FACTORY_VIEW_REFETCH_MS = 1_000;

/**
 * Refetch only while this window is showing a factory app.
 * The query key is that app, so another app is not polled.
 */
export function factoryViewRefetchInterval(
  viewingFactoryApp: boolean,
): number | false {
  return viewingFactoryApp ? FACTORY_VIEW_REFETCH_MS : false;
}

/** Discovery, Implementation, and Delivery each start when that phase opens. */
export function factoryPhaseKickoff(
  phase: FactoryPhase,
  previousSummary: string | null,
): string {
  if (phase === "discovery") return "Start Discovery.";
  if (phase === "implementation") {
    return (
      continuePrefill(phase, previousSummary) ??
      "Build the one-page site from what I approved in Discovery."
    );
  }
  return previousSummary
    ? `Start Delivery. Approved implementation summary:\n\n${previousSummary}`
    : "Start Delivery.";
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

/**
 * A factory phase chat has no composer. Home and any chat that is not a
 * factory phase keep it.
 */
export function showFactoryPhaseComposer(
  chats: readonly { title: string | null }[],
  chatTitle: string | null | undefined,
): boolean {
  return !(hasFactoryPhases(chats) && phaseFromTitle(chatTitle) != null);
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

/** Factory phase chats hide the assistant model name under each reply. */
export function showAssistantModelAttribution(factory: boolean): boolean {
  return !factory;
}

/**
 * Chats to delete once an app has a phase chat.
 * The full Discovery, Implementation, and Delivery set stays. When only some
 * phases exist, an empty phase is removed after another phase has messages.
 * Any other chat is removed. An app with no phase chat is left alone.
 */
export function factoryChatIdsToDrop<
  T extends { id: number; title: string | null; started: boolean },
>(chats: readonly T[]): number[] {
  const present = FACTORY_PHASES.flatMap((phase) => {
    const chat = factoryPhaseChats(chats)[phase];
    return chat ? [chat] : [];
  });
  if (present.length === 0) return [];
  const started = present.filter((chat) => chat.started);
  const keepSource = hasFactoryPhases(chats)
    ? present
    : started.length > 0
      ? started
      : present;
  const keep = new Set(keepSource.map((chat) => chat.id));
  return chats.filter((chat) => !keep.has(chat.id)).map((chat) => chat.id);
}
