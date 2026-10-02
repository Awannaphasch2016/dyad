import { useState } from "react";
import { Button } from "@/components/ui/button";

export interface HitlQuestionListItem {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: "open" | "answered";
  answeredByName: string | null;
  body: string | null;
  canAnswer: boolean;
}

export function HitlQuestionList({
  questions,
  pending,
  onAnswer,
}: {
  questions: HitlQuestionListItem[];
  pending: boolean;
  onAnswer: (questionId: string, body: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="hitl-questions">
      {questions.map((question) => (
        <HitlQuestionRow
          key={question.id}
          question={question}
          pending={pending}
          onAnswer={onAnswer}
        />
      ))}
    </div>
  );
}

function HitlQuestionRow({
  question,
  pending,
  onAnswer,
}: {
  question: HitlQuestionListItem;
  pending: boolean;
  onAnswer: (questionId: string, body: string) => void;
}) {
  const [body, setBody] = useState("");
  const roleLabel =
    question.targetRoleId === "project-manager"
      ? "Project Manager"
      : "Developer";
  return (
    <div
      className="rounded-md border bg-background px-2 py-2 text-sm"
      data-testid={`hitl-question-${question.id}`}
    >
      <p data-testid={`hitl-wait-${question.id}`}>
        Waiting on {roleLabel} for {question.stepId}. Status: {question.status}.
        {question.status === "answered" && question.answeredByName
          ? ` Answered by ${question.answeredByName}.`
          : ""}
      </p>
      {question.body != null && (
        <p className="mt-1 whitespace-pre-wrap" data-testid={`hitl-body-${question.id}`}>
          {question.body}
        </p>
      )}
      {question.canAnswer && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          data-testid={`hitl-answer-${question.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            const answer = body.trim();
            if (!answer) return;
            onAnswer(question.id, answer);
            setBody("");
          }}
        >
          <input
            aria-label={`Answer ${question.stepId}`}
            className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={pending}>
            Submit answer
          </Button>
        </form>
      )}
    </div>
  );
}
