import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useQueries } from "@tanstack/react-query";
import { Download, Lock } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Button } from "@/components/ui/button";
import { isStreamActive } from "@/chat_stream/transition";
import { useChatStreamState } from "@/hooks/useChatStream";
import { useChats } from "@/hooks/useChats";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useStreamChat } from "@/hooks/useStreamChat";
import { ipc } from "@/ipc/types";
import {
  FACTORY_PHASES,
  type FactoryPhase,
  canContinueFactoryPhase,
  continuePrefill,
  factoryPhaseChats,
  factoryPhaseHint,
  factoryPhaseKickoff,
  factoryPhaseLabel,
  factoryPhaseShade,
  hasFactoryPhases,
  isFactoryPhaseApproved,
  isFactoryPhaseUnlocked,
  latestFactoryPhaseSummary,
  latestUnlockedFactoryPhase,
  lockedFactoryPhaseReason,
  nextFactoryPhase,
  phaseFromTitle,
  showFactoryPhaseApproval,
} from "@/lib/factoryPhase";
import {
  buildFactoryDocument,
  canDownloadFactoryDocument,
  downloadFactoryDocument,
} from "@/lib/factoryDocuments";
import { approvalGate } from "@/auth/permissions";
import { useClerkRole } from "@/auth/session";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

function approvalsStorageKey(appId: number): string {
  return `dyad:factory-phase-approvals:${appId}`;
}

function readApprovals(appId: number | null): FactoryPhase[] {
  if (appId == null) return [];
  try {
    const raw = window.localStorage.getItem(approvalsStorageKey(appId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is FactoryPhase =>
          FACTORY_PHASES.includes(value as FactoryPhase),
        )
      : [];
  } catch {
    return [];
  }
}

function writeApprovals(appId: number, approvals: FactoryPhase[]): void {
  try {
    window.localStorage.setItem(
      approvalsStorageKey(appId),
      JSON.stringify(approvals),
    );
  } catch {
    // Storage can be unavailable; approval then lasts only for this page.
  }
}

export function FactoryPhaseBar() {
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const role = useClerkRole();
  const { chats } = useChats(appId);
  const { app } = useLoadApp(appId);
  const { selectChat } = useSelectChat();
  const { streamMessage } = useStreamChat();
  const streamState = useChatStreamState(chatId ?? undefined);
  const kickedOffChatIds = useRef(new Set<number>());
  const [approvals, setApprovals] = useState<{
    appId: number | null;
    phases: FactoryPhase[];
  }>(() => ({ appId, phases: readApprovals(appId) }));
  const approvedPhases =
    approvals.appId === appId ? approvals.phases : readApprovals(appId);

  const enabled = hasFactoryPhases(chats) && appId != null;
  const byPhase = enabled ? factoryPhaseChats(chats) : {};
  const phaseChatQueries = useQueries({
    queries: FACTORY_PHASES.map((item) => {
      const phaseChatId = byPhase[item]?.id ?? null;
      return {
        queryKey: queryKeys.chats.detail({ chatId: phaseChatId }),
        queryFn: () => ipc.chat.getChat(phaseChatId!),
        enabled: phaseChatId !== null,
      };
    }),
  });

  const messagesByPhase = new Map<
    FactoryPhase,
    { role: string; content: string }[]
  >();
  const started = new Set<FactoryPhase>();
  const summaries = new Map<FactoryPhase, string>();
  FACTORY_PHASES.forEach((item, index) => {
    const messages = phaseChatQueries[index]?.data?.messages ?? [];
    messagesByPhase.set(item, messages);
    if (messages.length > 0) started.add(item);
    const summary = latestFactoryPhaseSummary(messages, item);
    if (summary) summaries.set(item, summary);
  });
  const progress = { approved: new Set(approvedPhases), started };
  const progressLoaded = phaseChatQueries.every(
    (query) => query.data !== undefined,
  );

  const current = chats.find((chat) => chat.id === chatId);
  const phase = enabled ? phaseFromTitle(current?.title) : null;
  const phaseUnlocked =
    phase != null && isFactoryPhaseUnlocked(phase, progress);
  const fallbackPhase = latestUnlockedFactoryPhase(progress);
  const fallbackChatId = byPhase[fallbackPhase]?.id;
  const isStreaming = streamState ? isStreamActive(streamState) : false;
  const streamIdle =
    streamState != null &&
    streamState.phase === "idle" &&
    streamState.lastAcceptance == null;

  // A factory app only has its three phase chats; any other chat (or a locked
  // phase) sends the person to the phase they are allowed to work on.
  const isOffPhaseChat = enabled && current != null && phase == null;
  useEffect(() => {
    if (!isOffPhaseChat && (phase == null || phaseUnlocked)) return;
    if (!progressLoaded || appId == null) return;
    if (fallbackChatId == null || fallbackChatId === chatId) return;
    selectChat({ chatId: fallbackChatId, appId });
  }, [
    isOffPhaseChat,
    phase,
    phaseUnlocked,
    progressLoaded,
    appId,
    fallbackChatId,
    chatId,
    selectChat,
  ]);

  const currentMessageCount =
    phase != null ? (messagesByPhase.get(phase)?.length ?? 0) : 0;
  const previousPhase =
    phase != null ? FACTORY_PHASES[FACTORY_PHASES.indexOf(phase) - 1] : null;
  const kickoff =
    phase != null
      ? factoryPhaseKickoff(
          phase,
          previousPhase ? (summaries.get(previousPhase) ?? null) : null,
        )
      : null;

  useEffect(() => {
    if (
      kickoff == null ||
      chatId == null ||
      appId == null ||
      !phaseUnlocked ||
      !progressLoaded ||
      !streamIdle ||
      currentMessageCount > 0 ||
      kickedOffChatIds.current.has(chatId)
    ) {
      return;
    }
    kickedOffChatIds.current.add(chatId);
    void streamMessage({ prompt: kickoff, chatId, appId });
  }, [
    kickoff,
    chatId,
    appId,
    phaseUnlocked,
    progressLoaded,
    streamIdle,
    currentMessageCount,
    streamMessage,
  ]);

  if (!enabled || appId == null || !phase) return null;

  const next = nextFactoryPhase(phase);
  const nextChat = next ? byPhase[next] : undefined;
  const phaseSummary = summaries.get(phase) ?? null;
  const gate = approvalGate({
    status: role.status,
    roleId: role.roleId,
    phase,
  });
  const canApprove =
    canContinueFactoryPhase({
      hasPhaseSummary: phaseSummary != null,
      isStreaming,
    }) && gate.allowed;
  const alreadyApproved = isFactoryPhaseApproved(phase, progress);
  const showApproval =
    progressLoaded &&
    showFactoryPhaseApproval({
      phase,
      progress,
      hasPhaseSummary: phaseSummary != null,
    });

  const phaseShade = factoryPhaseShade({
    phase,
    progress,
    hasPhaseSummary: phaseSummary != null,
  });
  const canDownload = canDownloadFactoryDocument(phaseShade);
  const downloadDocumentation = () => {
    const document = buildFactoryDocument({
      phase,
      discoverySummary: summaries.get("discovery") ?? null,
      implementationSummary: summaries.get("implementation") ?? null,
      deliverySummary: summaries.get("delivery") ?? null,
      files: app?.files ?? [],
      githubOrg: app?.githubOrg ?? null,
      githubRepo: app?.githubRepo ?? null,
      githubBranch: app?.githubBranch ?? null,
      generatedOn: new Date().toISOString().slice(0, 10),
    });
    downloadFactoryDocument(document);
  };

  const recordApproval = () => {
    const phases = alreadyApproved
      ? approvedPhases
      : [...approvedPhases, phase];
    writeApprovals(appId, phases);
    setApprovals({ appId, phases });
  };

  const approveAndContinue = () => {
    if (!next || !nextChat) return;
    recordApproval();
    selectChat({
      chatId: nextChat.id,
      appId,
      prefillInput: continuePrefill(next, phaseSummary),
    });
  };

  return (
    <div
      className="border-b border-border bg-muted/40 px-3 py-2"
      data-testid="factory-phase-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        {FACTORY_PHASES.map((item) => {
          const chat = byPhase[item];
          if (!chat) return null;
          const selected = item === phase;
          const unlocked = isFactoryPhaseUnlocked(item, progress);
          const shade = factoryPhaseShade({
            phase: item,
            progress,
            hasPhaseSummary: summaries.has(item),
          });
          return (
            <Button
              key={item}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={selected}
              disabled={!unlocked}
              title={unlocked ? undefined : lockedFactoryPhaseReason(item)}
              data-testid={`factory-phase-${item}`}
              data-phase-shade={shade}
              className={cn(
                "disabled:opacity-100",
                shade === "finished" &&
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                shade === "in-progress" &&
                  "bg-primary/25 text-primary hover:bg-primary/35",
                shade === "not-started" && "bg-primary/10 text-primary/60",
                selected && "ring-2 ring-primary ring-offset-2",
              )}
              onClick={() => selectChat({ chatId: chat.id, appId })}
            >
              {!unlocked && <Lock className="size-3" aria-hidden />}
              {factoryPhaseLabel(item)}
            </Button>
          );
        })}
        {showApproval && next && nextChat && (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={!canApprove}
            data-testid="factory-phase-continue"
            onClick={approveAndContinue}
          >
            Approve and continue to {factoryPhaseLabel(next)}
          </Button>
        )}
        {showApproval && !next && (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={!canApprove}
            data-testid="factory-phase-continue"
            onClick={recordApproval}
          >
            Approve delivery
          </Button>
        )}
        {canDownload && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            data-testid="factory-phase-download"
            onClick={downloadDocumentation}
          >
            <Download className="size-3" aria-hidden />
            Download documentation
          </Button>
        )}
      </div>
      <p className={cn("mt-2 text-xs text-muted-foreground")}>
        {factoryPhaseHint(phase)}
        {showApproval && !gate.allowed && <> {gate.reason}</>}
        {showApproval && gate.allowed && !canApprove && (
          <>
            {" "}
            {isStreaming
              ? "wewebplus is working…"
              : `Approval unlocks when wewebplus posts its ${factoryPhaseLabel(phase)} summary.`}
          </>
        )}
      </p>
    </div>
  );
}
