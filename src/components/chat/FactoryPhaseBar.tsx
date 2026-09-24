import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useQueries } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Button } from "@/components/ui/button";
import { isStreamActive } from "@/chat_stream/transition";
import { useChatStreamState } from "@/hooks/useChatStream";
import { useChats } from "@/hooks/useChats";
import { useSelectChat } from "@/hooks/useSelectChat";
import { ipc } from "@/ipc/types";
import {
  FACTORY_PHASES,
  type FactoryPhase,
  canContinueFactoryPhase,
  continuePrefill,
  factoryPhaseChats,
  factoryPhaseHint,
  factoryPhaseLabel,
  hasFactoryPhases,
  isFactoryPhaseUnlocked,
  latestUnlockedFactoryPhase,
  lockedFactoryPhaseReason,
  nextFactoryPhase,
  phaseFromTitle,
} from "@/lib/factoryPhase";
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
  const { chats } = useChats(appId);
  const { selectChat } = useSelectChat();
  const streamState = useChatStreamState(chatId ?? undefined);
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

  const started = new Set<FactoryPhase>();
  const replied = new Set<FactoryPhase>();
  FACTORY_PHASES.forEach((item, index) => {
    const messages = phaseChatQueries[index]?.data?.messages ?? [];
    if (messages.length > 0) started.add(item);
    if (messages.some((message) => message.role === "assistant")) {
      replied.add(item);
    }
  });
  const progress = { approved: new Set(approvedPhases), started };
  const progressLoaded = phaseChatQueries.every(
    (query) => query.data !== undefined,
  );

  const current = chats.find((chat) => chat.id === chatId);
  const phase = enabled ? phaseFromTitle(current?.title) : null;
  const phaseLocked = phase != null && !isFactoryPhaseUnlocked(phase, progress);
  const fallbackPhase = latestUnlockedFactoryPhase(progress);
  const fallbackChatId = byPhase[fallbackPhase]?.id;

  useEffect(() => {
    if (!phaseLocked || !progressLoaded || appId == null) return;
    if (fallbackChatId == null || fallbackChatId === chatId) return;
    selectChat({ chatId: fallbackChatId, appId });
  }, [phaseLocked, progressLoaded, appId, fallbackChatId, chatId, selectChat]);

  if (!enabled || appId == null || !phase) return null;

  const next = nextFactoryPhase(phase);
  const nextChat = next ? byPhase[next] : undefined;
  const canContinue = canContinueFactoryPhase({
    hasAssistantReply: replied.has(phase),
    isStreaming: streamState ? isStreamActive(streamState) : false,
  });

  const approveAndContinue = () => {
    if (!next || !nextChat) return;
    const phases = approvedPhases.includes(phase)
      ? approvedPhases
      : [...approvedPhases, phase];
    writeApprovals(appId, phases);
    setApprovals({ appId, phases });
    selectChat({
      chatId: nextChat.id,
      appId,
      prefillInput: continuePrefill(next),
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
          return (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              disabled={!unlocked}
              title={unlocked ? undefined : lockedFactoryPhaseReason(item)}
              data-testid={`factory-phase-${item}`}
              onClick={() => selectChat({ chatId: chat.id, appId })}
            >
              {!unlocked && <Lock className="size-3" aria-hidden />}
              {factoryPhaseLabel(item)}
            </Button>
          );
        })}
        {next && nextChat && (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={!canContinue}
            data-testid="factory-phase-continue"
            onClick={approveAndContinue}
          >
            Approve and continue to {factoryPhaseLabel(next)}
          </Button>
        )}
      </div>
      <p className={cn("mt-2 text-xs text-muted-foreground")}>
        {factoryPhaseHint(phase)}
        {next && nextChat && !canContinue && (
          <> Continue unlocks after Dyad replies in this phase.</>
        )}
      </p>
    </div>
  );
}
