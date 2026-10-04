"use client";

import { useAuth } from "@clerk/nextjs";
import { useState, type FormEvent } from "react";
import { postPreviewPrompt } from "@/lib/gas_city_url";

export function PreviewPrompt() {
  const origin = process.env.NEXT_PUBLIC_GAS_CITY_URL?.trim() ?? "";
  const { getToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!origin) {
    if (process.env.NEXT_PUBLIC_VERCEL_ENV === "preview") {
      return <p className="error">The preview listener is not configured.</p>;
    }
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to continue.");
      const response = await postPreviewPrompt({
        prompt,
        idempotencyKey: crypto.randomUUID(),
        token,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error || `Listener returned HTTP ${response.status}`,
        );
      }
      setPrompt("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The preview listener is not configured.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="card">
      <form onSubmit={(event) => void onSubmit(event)}>
        <input
          aria-label="Prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button type="submit" disabled={pending}>
          Send prompt
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}
