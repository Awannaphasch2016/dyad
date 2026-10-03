"use client";

import { useAuth } from "@clerk/nextjs";
import { useState, type FormEvent } from "react";
import {
  gasCityFetch,
  gasCityOrigin,
  gasCityPaths,
} from "@/lib/gascity/browser_client";
import type { RunAccepted } from "@/lib/gascity/contract";

export function HomeComposer() {
  const { getToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<RunAccepted | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || pending) return;
    setPending(true);
    setError("");
    setAccepted(null);
    try {
      const token = await getToken();
      const response = await gasCityFetch(
        gasCityPaths.runs,
        {
          method: "POST",
          body: JSON.stringify({
            prompt: text,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        token,
      );
      const body = (await response.json()) as RunAccepted & { error?: string };
      if (!response.ok) {
        setError(body.error || "GasCity did not accept the prompt.");
        return;
      }
      if (body.electronInvoked !== false || body.orchestration !== "gascity") {
        setError("The response did not stay on the GasCity path.");
        return;
      }
      setAccepted(body);
      setPrompt("");
    } catch {
      setError("GasCity is unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <p className="muted">
        Describe the one-page site. Discovery asks the questions, then you
        approve Implementation and Delivery.
      </p>
      <p className="muted" data-testid="gascity-target">
        {gasCityOrigin()
          ? `Sending prompts to GasCity at ${gasCityOrigin()}.`
          : "Sending prompts to the GasCity contract on this origin. Electron is not called."}
      </p>
      <form className="composer" onSubmit={(event) => void onSubmit(event)}>
        <textarea
          aria-label="Prompt"
          value={prompt}
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="submit" disabled={pending || prompt.trim().length === 0}>
          {pending ? "Sending" : "Send to GasCity"}
        </button>
      </form>
      {error ? (
        <p className="error" data-testid="run-error">
          {error}
        </p>
      ) : null}
      {accepted ? (
        <article className="card" data-testid="run-accepted">
          <p>GasCity accepted the run.</p>
          <p className="muted" data-testid="run-id">
            {accepted.runId}
          </p>
          <p className="muted">Electron was not invoked.</p>
        </article>
      ) : null}
    </section>
  );
}
