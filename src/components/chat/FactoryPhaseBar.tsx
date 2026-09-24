import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { Button } from "@/components/ui/button";
import { useChats } from "@/hooks/useChats";
import { useSelectChat } from "@/hooks/useSelectChat";
import {
  FACTORY_PHASES,
  continuePrefill,
  factoryPhaseChats,
  factoryPhaseHint,
  factoryPhaseLabel,
  hasFactoryPhases,
  nextFactoryPhase,
  phaseFromTitle,
} from "@/lib/factoryPhase";
import { cn } from "@/lib/utils";

export function FactoryPhaseBar() {
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const { chats } = useChats(appId);
  const { selectChat } = useSelectChat();

  if (!hasFactoryPhases(chats) || appId == null) return null;

  const byPhase = factoryPhaseChats(chats);
  const current = chats.find((chat) => chat.id === chatId);
  const phase = phaseFromTitle(current?.title);
  if (!phase) return null;

  const next = nextFactoryPhase(phase);
  const nextChat = next ? byPhase[next] : undefined;

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
          return (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              onClick={() => selectChat({ chatId: chat.id, appId })}
            >
              {factoryPhaseLabel(item)}
            </Button>
          );
        })}
        {next && nextChat && (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={() =>
              selectChat({
                chatId: nextChat.id,
                appId,
                prefillInput: continuePrefill(next),
              })
            }
          >
            Continue to {factoryPhaseLabel(next)}
          </Button>
        )}
      </div>
      <p className={cn("mt-2 text-xs text-muted-foreground")}>
        {factoryPhaseHint(phase)}
      </p>
    </div>
  );
}
