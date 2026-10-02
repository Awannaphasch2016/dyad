"use client";

import { UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

type Question = {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: "open" | "answered";
  answeredByName: string | null;
  body: string | null;
  canAnswer: boolean;
};

type Payload = {
  caller: { displayName: string; roleId: string | null };
  questions: Question[];
};

function roleLabel(roleId: string): string {
  return roleId === "project-manager" ? "Project Manager" : "Developer";
}

export function QuestionBoard() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/questions", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/sign-in");
      return;
    }
    const body = (await response.json()) as Payload & { error?: string };
    if (!response.ok) {
      setError(body.error || "Could not load questions.");
      return;
    }
    setError("");
    setPayload(body);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 4000);
    void load();
    return () => window.clearInterval(timer);
  }, [load]);

  async function onAnswer(questionId: string) {
    const body = (drafts[questionId] ?? "").trim();
    if (!body) return;
    setPendingId(questionId);
    setError("");
    const response = await fetch(`/api/questions/${questionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const result = (await response.json()) as { error?: string };
    setPendingId(null);
    if (!response.ok) {
      setError(result.error || "Could not submit the answer.");
      return;
    }
    setDrafts((current) => ({ ...current, [questionId]: "" }));
    await load();
  }

  return (
    <main>
      <header>
        <div>
          <h1>Wewebplus</h1>
          <p className="muted">
            {payload
              ? `${payload.caller.displayName}${
                  payload.caller.roleId
                    ? ` · ${roleLabel(payload.caller.roleId)}`
                    : ""
                }`
              : "Loading questions"}
          </p>
        </div>
        <UserButton />
      </header>
      {error ? <p className="error">{error}</p> : null}
      {payload && payload.questions.length === 0 ? (
        <p className="muted">No questions yet.</p>
      ) : null}
      {payload?.questions.map((question) => (
        <article
          className="card"
          key={question.id}
          data-testid={`hitl-question-${question.id}`}
        >
          <p data-testid={`hitl-wait-${question.id}`}>
            Waiting on {roleLabel(question.targetRoleId)} for {question.stepId}.
            Status: {question.status}.
            {question.status === "answered" && question.answeredByName
              ? ` Answered by ${question.answeredByName}.`
              : ""}
          </p>
          {question.body != null ? (
            <p data-testid={`hitl-body-${question.id}`}>{question.body}</p>
          ) : null}
          {question.canAnswer ? (
            <form
              data-testid={`hitl-answer-${question.id}`}
              onSubmit={(event) => {
                event.preventDefault();
                void onAnswer(question.id);
              }}
            >
              <input
                aria-label={`Answer ${question.stepId}`}
                value={drafts[question.id] ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
              />
              <button type="submit" disabled={pendingId === question.id}>
                Submit answer
              </button>
            </form>
          ) : null}
        </article>
      ))}
    </main>
  );
}
