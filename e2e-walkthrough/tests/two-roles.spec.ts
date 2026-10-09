import { clerk } from "@clerk/testing/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  ROLES,
  openWalkthrough,
  pressComposerEnter,
  projectSnapshot,
  sendWalkthroughPrompt,
  signInAs,
  writeReport,
} from "./walkthrough";

// Same sentence as PROMPT in scripts/doppler/bolt-reset-project.mjs.
const PROMPT = "A single page that lists the North Pier lunch menu.";
const ANSWER = "Approved.";
const BLOCKED_PROMPT = "Developer should not send.";
// The page polls every 2 seconds. A handover has to show up on the other
// screen within a handful of those polls.
const HANDOVER_MS = 15_000;
const MODEL_MS = 3 * 60 * 1000;

interface Snapshot {
  phase?: string;
  roleId?: string;
  canSend?: boolean;
  canTransition?: boolean;
  canDownload?: boolean;
  waitingLabel?: string | null;
  transitionLabel?: string | null;
  messages?: { id: string; role: string; content: string }[];
  questions?: {
    status?: string;
    canAnswer?: boolean;
    answeredByName?: string | null;
  }[];
}

function filePaths(body: Snapshot): string[] {
  const found = new Set<string>();
  for (const message of body.messages ?? []) {
    if (message.role !== "assistant") continue;
    for (const match of message.content.matchAll(/filePath="([^"]+)"/g)) {
      found.add(match[1]);
    }
  }
  return [...found];
}

async function untilSnapshot(
  page: Page,
  ready: (body: Snapshot) => boolean,
  timeout: number,
  message: string,
) {
  const seen: Snapshot[] = [];
  let detail = "";
  try {
    await expect
      .poll(
        async () => {
          const probe = await projectSnapshot(page);
          const body = (probe.body ?? {}) as Snapshot;
          detail = JSON.stringify({
            status: probe.status,
            phase: body.phase,
            canTransition: body.canTransition,
            waitingLabel: body.waitingLabel,
            messages: (body.messages ?? []).map((item) => item.id),
            questions: body.questions ?? [],
          });
          if (probe.status === 200 && ready(body)) {
            seen[0] = body;
            return true;
          }
          return false;
        },
        { timeout, intervals: [2_000], message },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${message}\n${detail}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return seen[0] ?? {};
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: true });
}

async function downloadBytes(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("shared-download").click(),
  ]);
  const file = await download.path();
  if (!file) throw new Error("the download was not saved");
  return readFileSync(file);
}

function contextOptions(videoDir: string) {
  return {
    baseURL:
      process.env.WALKTHROUGH_URL ??
      "https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev",
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir },
  };
}

test("both roles walk one shared project", async ({ browser }) => {
  test.setTimeout(8 * 60 * 1000);
  test.skip(
    !ROLES.pm.userId || !ROLES.dev.userId,
    "a walkthrough user id is absent",
  );

  const pmContext = await browser.newContext(
    contextOptions("test-results/two-roles-pm"),
  );
  const devContext = await browser.newContext(
    contextOptions("test-results/two-roles-dev"),
  );
  const pmPage = await pmContext.newPage();
  const devPage = await devContext.newPage();
  const devInstalls: string[] = [];
  devPage.on("console", (message) => {
    if (/npm install|pnpm install/i.test(message.text())) {
      devInstalls.push(message.text());
    }
  });

  try {
    await openBoth(pmContext, pmPage, devContext, devPage);
    await signInAs(pmPage, ROLES.pm.userId);
    await signInAs(devPage, ROLES.dev.userId);
    await expect(pmPage.getByTestId("bolt-account")).toContainText(
      ROLES.pm.label,
    );
    await expect(devPage.getByTestId("bolt-account")).toContainText(
      ROLES.dev.label,
    );

    await untilSnapshot(
      pmPage,
      (body) =>
        body.phase === "discovery" &&
        body.canSend === true &&
        body.canTransition === true,
      30_000,
      "Discovery did not open for the Project Manager",
    );
    await untilSnapshot(
      devPage,
      (body) =>
        body.phase === "discovery" &&
        body.canSend === false &&
        body.roleId === "developer" &&
        body.waitingLabel === "Waiting on the Project Manager.",
      30_000,
      "Discovery did not open for the Developer",
    );
    await expect(devPage.getByTestId("shared-gate-waiting")).toContainText(
      "Waiting on the Project Manager.",
    );
    await shot(pmPage, "two-roles-1-discovery-pm");
    await shot(devPage, "two-roles-1-discovery-dev");

    await pressComposerEnter(devPage, BLOCKED_PROMPT);
    await expect
      .poll(
        async () => {
          const body = (await projectSnapshot(devPage)).body as {
            messages?: unknown[];
          } | null;
          return (body?.messages ?? []).length;
        },
        { timeout: 5_000, intervals: [1_000] },
      )
      .toBe(0);
    const blocked = await devPage.evaluate(async (text) => {
      const token = await window.Clerk?.session?.getToken();
      const response = await fetch("/api/project", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: "record",
          messages: [
            { id: "dev-should-not-send", role: "user", content: text },
          ],
        }),
      });
      return response.status;
    }, BLOCKED_PROMPT);
    expect(blocked).toBe(403);

    const sent = await sendWalkthroughPrompt(pmPage, PROMPT);
    const replied = await untilSnapshot(
      pmPage,
      (body) =>
        (body.messages ?? []).some(
          (message) =>
            message.role === "user" && message.content.includes(PROMPT),
        ) &&
        (body.messages ?? []).some(
          (message) => message.role === "assistant" && message.content.trim(),
        ),
      MODEL_MS,
      "the assistant reply was not stored",
    );
    const ids = (replied.messages ?? []).map((message) => message.id);
    const devReply = await untilSnapshot(
      devPage,
      (body) =>
        ids.every((id) =>
          (body.messages ?? []).some((message) => message.id === id),
        ),
      HANDOVER_MS,
      "the Developer did not receive the discovery messages",
    );
    await expect(devPage.getByText(PROMPT).first()).toBeVisible();
    const files = filePaths(replied);
    if (files.length > 0) {
      const name = files[0].split("/").pop() ?? files[0];
      await expect(
        devPage.getByText(name, { exact: true }).first(),
      ).toBeAttached({
        timeout: 20_000,
      });
    }
    await shot(pmPage, "two-roles-2-reply-pm");
    await shot(devPage, "two-roles-2-reply-dev");

    await pmPage.getByTestId("shared-gate-transition").click();
    await untilSnapshot(
      devPage,
      (body) =>
        body.phase === "implementation" &&
        body.questions?.[0]?.status === "open" &&
        body.questions?.[0]?.canAnswer === true,
      HANDOVER_MS,
      "the Developer did not reach Implementation",
    );
    const pmImplementation = await untilSnapshot(
      pmPage,
      (body) =>
        body.phase === "implementation" &&
        body.canTransition === false &&
        body.waitingLabel === "Waiting on the Developer." &&
        body.questions?.[0]?.canAnswer === false,
      HANDOVER_MS,
      "the Project Manager did not reach Implementation",
    );
    await expect(
      devPage.getByTestId("factory-phase-implementation"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(pmPage.getByTestId("shared-gate")).toContainText(
      "Waiting on the Developer.",
    );
    await expect(pmPage.getByLabel("Implementation answer")).toHaveCount(0);
    await expect(devPage.getByLabel("Implementation answer")).toBeVisible();
    await shot(pmPage, "two-roles-3-implementation-pm");
    await shot(devPage, "two-roles-3-implementation-dev");

    await devPage.getByLabel("Implementation answer").fill(ANSWER);
    await devPage.getByRole("button", { name: "Submit answer" }).click();
    await untilSnapshot(
      pmPage,
      (body) => body.questions?.[0]?.status === "answered",
      HANDOVER_MS,
      "the Project Manager did not see the answer",
    );
    await expect(pmPage.getByTestId("shared-gate")).toContainText("Answered");
    await expect(pmPage.getByTestId("shared-gate-transition")).toHaveCount(0);
    const devTransition = devPage.getByTestId("shared-gate-transition");
    await expect(devTransition).toBeVisible();
    await expect(devTransition).toContainText("Move to Delivery");
    await shot(pmPage, "two-roles-4-answered-pm");
    await shot(devPage, "two-roles-4-answered-dev");

    await devTransition.click();
    await untilSnapshot(
      pmPage,
      (body) =>
        body.phase === "delivery" &&
        body.canTransition === true &&
        body.transitionLabel === "Approve delivery",
      HANDOVER_MS,
      "the Project Manager did not reach Delivery",
    );
    await untilSnapshot(
      devPage,
      (body) =>
        body.phase === "delivery" &&
        body.canTransition === false &&
        body.waitingLabel === "Waiting on the Project Manager.",
      HANDOVER_MS,
      "the Developer did not reach Delivery",
    );
    await expect(pmPage.getByTestId("shared-gate-transition")).toContainText(
      "Approve delivery",
    );
    await expect(devPage.getByTestId("shared-gate-waiting")).toContainText(
      "Waiting on the Project Manager.",
    );
    await shot(pmPage, "two-roles-5-delivery-pm");
    await shot(devPage, "two-roles-5-delivery-dev");

    await pmPage.getByTestId("shared-gate-transition").click();
    await untilSnapshot(
      pmPage,
      (body) => body.phase === "delivered" && body.canDownload === true,
      HANDOVER_MS,
      "the Project Manager did not reach Delivered",
    );
    await untilSnapshot(
      devPage,
      (body) => body.phase === "delivered" && body.canDownload === true,
      HANDOVER_MS,
      "the Developer did not reach Delivered",
    );
    await expect(pmPage.getByTestId("shared-gate")).toHaveCount(0);
    await expect(devPage.getByTestId("shared-gate")).toHaveCount(0);
    await expect(pmPage.getByTestId("shared-download")).toBeVisible();
    await expect(devPage.getByTestId("shared-download")).toBeVisible();
    const pmFile = await downloadBytes(pmPage);
    const devFile = await downloadBytes(devPage);
    expect(pmFile.length).toBeGreaterThan(0);
    expect(pmFile.equals(devFile)).toBe(true);
    expect(pmFile.toString("utf8")).toContain("North Pier");
    await shot(pmPage, "two-roles-6-delivered-pm");
    await shot(devPage, "two-roles-6-delivered-dev");

    await pmPage.reload();
    await devPage.reload();
    await clerk.loaded({ page: pmPage });
    await clerk.loaded({ page: devPage });
    await untilSnapshot(
      pmPage,
      (body) => body.phase === "delivered" && body.canDownload === true,
      30_000,
      "reload did not keep Delivered for the Project Manager",
    );
    await untilSnapshot(
      devPage,
      (body) => body.phase === "delivered" && body.roleId === "developer",
      30_000,
      "reload did not keep Delivered for the Developer",
    );
    await expect(pmPage.getByTestId("factory-phase-delivery")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(devPage.getByTestId("shared-download")).toBeVisible();

    await clerk.signOut({ page: pmPage });
    await clerk.signOut({ page: devPage });
    await expect(pmPage.getByTestId("bolt-sign-in")).toBeVisible();
    await expect(devPage.getByTestId("bolt-sign-in")).toBeVisible();
    expect((await projectSnapshot(pmPage)).status).toBe(401);
    expect((await projectSnapshot(devPage)).status).toBe(401);
    expect(devInstalls.length).toBeLessThan(2);

    writeReport("two-roles", {
      summary: `both roles · composer covered: ${sent.covered} · developer record before the prompt: ${blocked} · messages ${devReply.messages?.length ?? 0} · files ${files.join(",") || "none"} · dev install logs ${devInstalls.length} · downloads ${pmFile.length} bytes and identical · reload kept delivered · signed out 401`,
      prompt: PROMPT,
      answer: ANSWER,
      composerCoveredByGate: sent.covered,
      developerRecordStatus: blocked,
      messageIds: ids,
      files,
      devInstallLogs: devInstalls.length,
      downloadBytes: pmFile.length,
      pmWaitingAtImplementation: pmImplementation.waitingLabel ?? null,
    });
  } finally {
    await pmContext.close();
    await devContext.close();
  }
});

async function openBoth(
  pmContext: BrowserContext,
  pmPage: Page,
  devContext: BrowserContext,
  devPage: Page,
) {
  await openWalkthrough(pmContext, pmPage);
  await openWalkthrough(devContext, devPage);
}

test("an account outside Wewebplus cannot see the project", async ({
  browser,
}) => {
  const userId = process.env.WALKTHROUGH_OUTSIDER_USER_ID ?? "";
  test.skip(!userId, "WALKTHROUGH_OUTSIDER_USER_ID is absent");
  const context = await browser.newContext(
    contextOptions("test-results/two-roles-outsider"),
  );
  const page = await context.newPage();
  try {
    await openWalkthrough(context, page);
    await signInAs(page, userId);
    await expect(page.getByTestId("bolt-account")).toBeVisible();
    await expect(page.getByTestId("bolt-account")).not.toContainText(
      "Wewebplus",
    );
    await expect(page.getByTestId("bolt-account")).not.toContainText(
      "Project Manager",
    );
    await expect(page.getByTestId("bolt-account")).not.toContainText(
      "Developer",
    );
    await expect(page.getByTestId("shared-gate")).toHaveCount(0);
    const probe = await projectSnapshot(page);
    expect(probe.status).toBe(404);
    await shot(page, "two-roles-outsider");
    writeReport("outsider", {
      summary: `outsider · ${userId} · /api/project ${probe.status} · no Wewebplus role · no shared gate`,
      userId,
      status: probe.status,
    });
    await clerk.signOut({ page });
  } finally {
    await context.close();
  }
});
