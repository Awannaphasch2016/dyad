"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import {
  ELECTRON_CAPABILITIES,
  IPC_DOMAINS,
  runtimeOwner,
  type ElectronCapability,
  type RuntimeOwner,
} from "@/lib/boundary";
import { gasCityFetch, gasCityPaths } from "@/lib/gascity/browser_client";
import type { ElectronCapabilityResponse } from "@/lib/gascity/contract";

const OWNER_LABEL: Record<RuntimeOwner, string> = {
  browser: "Browser",
  gascity: "GasCity",
  electron: "Electron, only when GasCity asks",
};

export function RuntimeBoundary() {
  const { getToken } = useAuth();
  const [result, setResult] = useState<ElectronCapabilityResponse | null>(null);
  const [error, setError] = useState("");

  async function ask(capability: ElectronCapability) {
    setError("");
    setResult(null);
    const token = await getToken();
    const response = await gasCityFetch(
      gasCityPaths.electronCapability,
      {
        method: "POST",
        body: JSON.stringify({
          capability,
          reason: `DYAD asked GasCity for ${capability}`,
        }),
      },
      token,
    );
    const body = (await response.json()) as ElectronCapabilityResponse & {
      error?: string;
    };
    if (response.status !== 409 || body.electronInvoked !== false) {
      setError(body.error || "GasCity did not keep Electron off this request.");
      return;
    }
    setResult(body);
  }

  return (
    <section>
      <p className="muted">
        This page is the DYAD frontend. Prompts and gates go to GasCity.
        Electron stays off the path until GasCity asks for a machine-local
        capability.
      </p>
      <p className="muted">
        The standalone HITL page that used to live here is retired. Gates are at
        Home → Gates.
      </p>
      <table className="boundary">
        <thead>
          <tr>
            <th>Former Electron IPC domain</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {IPC_DOMAINS.map((domain) => (
            <tr key={domain}>
              <td>{domain}</td>
              <td>{OWNER_LABEL[runtimeOwner(domain)]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="capability-row">
        {ELECTRON_CAPABILITIES.map((capability) => (
          <button
            key={capability}
            type="button"
            onClick={() => void ask(capability)}
          >
            Ask GasCity for {capability}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <article className="card" data-testid="electron-required">
          <p>
            GasCity returned electron-required for {result.capability}. Electron
            was not invoked.
          </p>
        </article>
      ) : null}
    </section>
  );
}
