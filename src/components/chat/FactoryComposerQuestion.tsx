import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Send } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChats } from "@/hooks/useChats";
import { ipc } from "@/ipc/types";
import {
  type FactoryPhase,
  factoryViewRefetchInterval,
  hasFactoryPhases,
  phaseFromTitle,
} from "@/lib/factoryPhase";
import { queryKeys } from "@/lib/queryKeys";

export interface FactoryComposerQuestionItem {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: "open" | "answered";
  body: string | null;
  canAnswer: boolean;
}

/** Open factory question for this chat, shown in the composer instead of the phase bar. */
export function useFactoryOpenQuestion(chatId: number | undefined): {
  appId: number | null;
  phase: FactoryPhase | null;
  question: FactoryComposerQuestionItem | null;
} {
  const appId = useAtomValue(selectedAppIdAtom);
  const { chats } = useChats(appId);
  const phase =
    chatId != null && hasFactoryPhases(chats)
      ? phaseFromTitle(chats.find((chat) => chat.id === chatId)?.title)
      : null;
  const enabled = appId != null && phase != null;
  const questionsQuery = useQuery({
    queryKey: queryKeys.factory.questions(appId, phase),
    enabled,
    refetchInterval: factoryViewRefetchInterval(enabled),
    queryFn: async () => {
      if (appId == null || phase == null) return [];
      const result = await ipc.factory.listQuestions({ appId, phase });
      return result.questions;
    },
  });
  const machinesQuery = useQuery({
    queryKey: queryKeys.factory.machines(appId),
    enabled,
    refetchInterval: factoryViewRefetchInterval(enabled),
    queryFn: async () => {
      if (appId == null) return [];
      const result = await ipc.factory.listPhaseMachines({ appId });
      return result.machines;
    },
  });
  const machine = machinesQuery.data?.find((item) => item.phase === phase);
  const show =
    phase != null &&
    (machine == null || machine.status === "waiting_for_answer");
  const question = show
    ? ((questionsQuery.data ?? []).find((item) => item.status === "open") ??
      null)
    : null;
  return { appId, phase, question };
}

export function FactoryComposerQuestion({
  appId,
  phase,
  question,
}: {
  appId: number;
  phase: FactoryPhase;
  question: FactoryComposerQuestionItem;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const roleLabel =
    question.targetRoleId === "project-manager"
      ? "Project Manager"
      : "Developer";

  const submit = async () => {
    const answer = body.trim();
    if (!answer || !question.canAnswer || pending) return;
    setPending(true);
    try {
      await ipc.factory.answerQuestion({
        appId,
        questionId: question.id,
        body: answer,
      });
      setBody("");
      await queryClient.invalidateQueries({
        queryKey: queryKeys.factory.questions(appId, phase),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.factory.machines(appId),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="border-b border-border bg-muted/30"
      data-testid={`hitl-question-${question.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-sm">Questions</span>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <p
          className="text-xs text-muted-foreground"
          data-testid={`hitl-wait-${question.id}`}
        >
          Waiting on {roleLabel} for {question.stepId}. Status:{" "}
          {question.status}.
        </p>
        {question.canAnswer && question.body != null && (
          <form
            data-testid={`hitl-answer-${question.id}`}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Label className="text-sm font-medium text-foreground">
              <span data-testid={`hitl-body-${question.id}`}>
                {question.body}
              </span>
              <span className="text-red-500 ml-1">*</span>
            </Label>
            <Input
              autoFocus
              className="mt-2"
              aria-label={`Answer ${question.stepId}`}
              placeholder="Type your answer..."
              value={body}
              disabled={pending}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={pending || body.trim().length === 0}
              >
                <Send size={14} className="mr-1.5" />
                Submit answer
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
