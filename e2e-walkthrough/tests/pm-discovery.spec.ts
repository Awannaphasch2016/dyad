import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ROLES,
  openWalkthrough,
  projectSnapshot,
  finishDiscovery,
  sendWalkthroughPrompt,
  signInAs,
  writeReport,
} from "./walkthrough";

// Same sentence as PROMPT in scripts/doppler/bolt-reset-project.mjs. The
// database check looks for it in the stored user message.
const PROMPT = "A single page that lists the North Pier lunch menu.";

interface Snapshot {
  phase?: string;
  roleId?: string;
  canSend?: boolean;
  canTransition?: boolean;
  waitingLabel?: string | null;
  transitionLabel?: string | null;
  messages?: { id: string; role: string; content: string }[];
  questions?: { status?: string; canAnswer?: boolean }[];
}

async function untilSnapshot(
  page: Page,
  ready: (body: Snapshot) => boolean,
  timeout: number,
  message: string,
) {
  const seen: Snapshot[] = [];
  await expect
    .poll(
      async () => {
        const probe = await projectSnapshot(page);
        const body = (probe.body ?? {}) as Snapshot;
        if (probe.status === 200 && ready(body)) {
          seen[0] = body;
          return true;
        }
        return false;
      },
      { timeout, intervals: [2_000], message },
    )
    .toBe(true);
  return seen[0] ?? {};
}

test("pm: discovery prompt moves the shared project to implementation", async ({
  page,
  context,
}) => {
  test.setTimeout(16 * 60 * 1000);
  const role = ROLES.pm;
  test.skip(!role.userId, "WALKTHROUGH_PM_USER_ID is absent");

  await openWalkthrough(context, page);
  await signInAs(page, role.userId);
  await expect(page.getByTestId("bolt-account")).toContainText(role.label);

  const discovery = await untilSnapshot(
    page,
    (body) => body.phase === "discovery" && body.canSend === true,
    30_000,
    "Discovery did not open for the Project Manager",
  );
  await expect(page.getByTestId("factory-phase-discovery")).toBeVisible();
  await page.screenshot({
    path: "artifacts/pm-discovery-1-gate.png",
    fullPage: true,
  });

  const sent = await sendWalkthroughPrompt(page, PROMPT);
  const finished = await finishDiscovery(page);
  const replied = { messages: finished.messages };
  await expect(page.getByText(PROMPT).first()).toBeVisible();
  const gate = page.getByTestId("shared-gate-transition");
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Move to Implementation");
  await page.screenshot({
    path: "artifacts/pm-discovery-2-reply.png",
    fullPage: true,
  });

  await gate.click();
  const implementation = await untilSnapshot(
    page,
    (body) =>
      body.phase === "implementation" &&
      body.canSend === false &&
      body.canTransition === false &&
      body.waitingLabel === "Waiting on the Developer." &&
      body.questions?.[0]?.status === "open" &&
      body.questions?.[0]?.canAnswer === false,
    30_000,
    "the project did not move to Implementation",
  );
  const card = page.getByTestId("shared-gate");
  await expect(card).toContainText("Implementation review");
  await expect(card).toContainText("Waiting on the Developer.");
  await expect(page.getByTestId("shared-gate-transition")).toHaveCount(0);
  await expect(page.getByLabel("Implementation answer")).toHaveCount(0);
  await expect(page.getByTestId("factory-phase-implementation")).toBeVisible();
  await page.screenshot({
    path: "artifacts/pm-discovery-3-implementation.png",
    fullPage: true,
  });

  await page.reload();
  await clerk.loaded({ page });
  const reloaded = await untilSnapshot(
    page,
    (body) => body.phase === "implementation" && body.roleId === role.roleId,
    30_000,
    "reload did not keep Implementation",
  );
  await expect(page.getByTestId("shared-gate")).toContainText(
    "Waiting on the Developer.",
  );
  await page.screenshot({
    path: "artifacts/pm-discovery-4-reload.png",
    fullPage: true,
  });

  await clerk.signOut({ page });
  await expect(page.getByTestId("bolt-sign-in")).toBeVisible();
  const signedOut = await projectSnapshot(page);
  expect(signedOut.status).toBe(401);

  writeReport("pm-discovery", {
    summary: `pm · prompt stored · assistant stored · discovery follow-ups ${finished.followUps} · composer covered by the gate: ${sent.covered} · phase ${discovery.phase} → ${implementation.phase} · waiting: ${implementation.waitingLabel} · reload keeps ${reloaded.phase} · signed-out status ${signedOut.status} · messages ${replied.messages?.length ?? 0}`,
    prompt: PROMPT,
    composerCoveredByGate: sent.covered,
    discoveryPhase: discovery.phase,
    implementationPhase: implementation.phase,
    waitingLabel: implementation.waitingLabel,
    transitionLabel: discovery.transitionLabel,
    messageCount: replied.messages?.length ?? 0,
    reloadPhase: reloaded.phase,
    signedOutStatus: signedOut.status,
  });
});
