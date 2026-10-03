"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { gasCityFetch, gasCityPaths } from "@/lib/gascity/browser_client";
import { runtimeStatusLine } from "@/lib/runtime_status";

type Question = {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: "open" | "answered";
  answeredByName: string | null;
  body: string | null;
  canAnswer: boolean;
  runtimeRunId?: string | null;
};

type Payload = {
  caller: { displayName: string; roleId: string | null };
  questions: Question[];
  electronInvoked?: boolean;
};

function roleLabel(roleId: string): string {
  return roleId === "project-manager" ? "Project Manager" : "Developer";
}

function actionError(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export function QuestionBoard() {
  const { getToken } = useAuth();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const response = await gasCityFetch(
        gasCityPaths.questions,
        undefined,
        token,
      );
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
    } catch (caught) {
      setError(actionError(caught, "Could not load questions."));
    }
  }, [getToken]);

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
    try {
      const token = await getToken();
      const response = await gasCityFetch(
        gasCityPaths.answer(questionId),
        { method: "POST", body: JSON.stringify({ body }) },
        token,
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error || "Could not submit the answer.");
        return;
      }
      setDrafts((current) => ({ ...current, [questionId]: "" }));
      await load();
    } catch (caught) {
      setError(actionError(caught, "Could not submit the answer."));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section>
      <p className="muted">
        {payload
          ? `${payload.caller.displayName}${
              payload.caller.roleId
                ? ` · ${roleLabel(payload.caller.roleId)}`
                : ""
            }`
          : error
            ? "Gates"
            : "Loading questions"}
      </p>
      <p className="muted">
        Gates are part of DYAD. Answers go to GasCity, which continues the run.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {payload && payload.questions.length === 0 ? (
        <p className="muted">No questions yet.</p>
      ) : null}
      {payload?.questions.map((question) => {
        const runtime = runtimeStatusLine({
          status: question.status,
          runtimeRunId: question.runtimeRunId ?? null,
          preview: Boolean(process.env.NEXT_PUBLIC_GAS_CITY_URL?.trim()),
        });
        return (
          <article
            className="card"
            key={question.id}
            data-testid={`hitl-question-${question.id}`}
          >
            <p data-testid={`hitl-wait-${question.id}`}>
              Waiting on {roleLabel(question.targetRoleId)} for{" "}
              {question.stepId}. Status: {question.status}.
              {question.status === "answered" && question.answeredByName
                ? ` Answered by ${question.answeredByName}.`
                : ""}
            </p>
            {question.body != null ? (
              <p data-testid={`hitl-body-${question.id}`}>{question.body}</p>
            ) : null}
            {runtime ? (
              <p data-testid={`hitl-runtime-${question.id}`}>{runtime}</p>
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
        );
      })}
    </section>
  );
}
