import { randomUUID } from "node:crypto";

export const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";

const insertQuestion = `insert into wewebplus.questions (
  id, org_id, app_id, phase, run_id, step_id, target_role_id, visibility,
  status, body, idempotency_key
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
on conflict (org_id, idempotency_key) do nothing
returning run_id`;

const selectQuestion = `select run_id from wewebplus.questions
where org_id = $1 and idempotency_key = $2`;

function storedRunId(row, fallback) {
  if (!row) return fallback;
  if (typeof row.run_id === "string" && row.run_id) return row.run_id;
  if (typeof row[0] === "string" && row[0]) return row[0];
  return fallback;
}

/**
 * Write one open gate into the preview database.
 * This function does not call Dyad. The preview poller starts the run
 * after the answer is released.
 */
export async function continueRun({
  prompt,
  idempotencyKey,
  query,
  appId = "preview",
}) {
  if (!query) throw new Error("Question store is unavailable.");
  const runId = `gascity-run:${randomUUID()}`;
  const inserted = await query(insertQuestion, [
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
  const created = Array.isArray(inserted) ? inserted[0] : null;
  if (created) {
    return {
      runId: storedRunId(created, runId),
      electronInvoked: false,
      stored: true,
    };
  }
  const existing = await query(selectQuestion, [
    WEWEBPLUS_ORG_ID,
    idempotencyKey,
  ]);
  const row = Array.isArray(existing) ? existing[0] : null;
  if (!row) return { runId, electronInvoked: false, stored: false };
  return {
    runId: storedRunId(row, runId),
    electronInvoked: false,
    stored: true,
  };
}
