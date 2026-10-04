import { randomUUID } from "node:crypto";

export const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";

const insertQuestion = `insert into wewebplus.questions (
  id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
  status, body, idempotency_key
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
on conflict (org_id, idempotency_key) do nothing`;

/**
 * Write one open gate into the preview database, then ask Dyad to run.
 * A missing app or a refused factory call does not remove the gate.
 * Electron is never invoked from this function.
 */
export async function continueRun({
  prompt,
  idempotencyKey,
  query,
  dyadFetch,
  dyadBase = "",
  bridgeToken = "",
  appId = 1,
}) {
  const runId = `gascity-run:${randomUUID()}`;
  if (query) {
    await query(insertQuestion, [
      randomUUID(),
      WEWEBPLUS_ORG_ID,
      String(appId),
      "implementation",
      runId,
      "plan-approve",
      "project-manager",
      "role",
      "open",
      prompt,
      idempotencyKey,
    ]);
  }
  let dyadStatus = null;
  const base = dyadBase.replace(/\/$/, "");
  if (dyadFetch && base && bridgeToken) {
    try {
      const response = await dyadFetch(
        `${base}/v1/apps/${appId}/phases/implementation/runs`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${bridgeToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ prompt, idempotencyKey }),
        },
      );
      dyadStatus = response.status;
    } catch {
      dyadStatus = 0;
    }
  }
  return { runId, dyadStatus, electronInvoked: false };
}
