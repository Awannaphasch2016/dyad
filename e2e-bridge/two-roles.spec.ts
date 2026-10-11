import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  installClerkTestingToken,
  membershipRole,
  signInAs,
  factoryAccount,
} from "./signin";

const BRIDGE_URL = process.env.DYAD_BRIDGE_URL ?? "http://127.0.0.1:8372";
const USER_DATA = process.env.DYAD_DEV_USER_DATA_DIR?.trim() ?? "";
const QUESTION_WAIT_MS = 20 * 60 * 1000;
const OUTPUT_DIR = path.join(process.cwd(), "e2e-bridge/output");
const VIDEO_DIR = path.join(process.cwd(), "e2e-bridge/videos");

type Phase = "discovery" | "implementation" | "delivery";

interface EvidenceQuestion {
  id: string;
  phase: Phase;
  role: string;
  resumeRunId: string | null;
}

const evidence: {
  appId: number | null;
  questions: EvidenceQuestion[];
  leftAppWhileQuestionOpen: boolean;
} = {
  appId: null,
  questions: [],
  leftAppWhileQuestionOpen: false,
};

function answerFromBody(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim().slice(0, 180);
  return `Recorded from the question: ${compact}`;
}

function promptHash(body: string, answer: string): string {
  return createHash("sha256").update(`${body}\n\n${answer}`).digest("hex");
}

function databasePath(): string {
  if (!USER_DATA) {
    throw new Error("DYAD_DEV_USER_DATA_DIR is required.");
  }
  return path.join(USER_DATA, "sqlite.db");
}

function readRows(
  sql: string,
  params: Array<string | number>,
): Array<Record<string, unknown>> {
  const database = new DatabaseSync(databasePath(), { readOnly: true });
  try {
    return database.prepare(sql).all(...params) as Array<
      Record<string, unknown>
    >;
  } finally {
    database.close();
  }
}

async function readRowsSoon(
  sql: string,
  params: Array<string | number>,
): Promise<Array<Record<string, unknown>>> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return readRows(sql, params);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last;
}

function phaseLabel(phase: Phase): string {
  if (phase === "discovery") return "Discovery";
  if (phase === "implementation") return "Implementation";
  return "Delivery";
}

async function signedInPage(
  browser: Browser,
  userId: string,
  organizationId: string,
  videoName: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
  });
  await installClerkTestingToken(context);
  const page = await context.newPage();
  try {
    await page.goto(BRIDGE_URL);
    await signInAs(page, userId, organizationId);
    await expect(page.getByTestId("title-bar-user-button")).toBeVisible({
      timeout: 60_000,
    });
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    page,
    close: async () => {
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(path.join(VIDEO_DIR, `${videoName}.webm`));
      }
    },
  };
}

async function openFactoryApp(page: Page, appName: string): Promise<void> {
  await page.goto(BRIDGE_URL);
  await expect(page.getByTestId("title-bar-user-button")).toBeVisible({
    timeout: 60_000,
  });
  const item = page.getByTestId(`app-list-item-${appName}`);
  if (!(await item.isVisible().catch(() => false))) {
    const toggle = page.getByRole("button", { name: /toggle sidebar/i });
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.getByRole("button", { name: "Apps" }).hover();
  }
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
  await expect(page.getByTestId("app-details-page")).toBeVisible();
  await page.getByTestId("app-details-screenshot-open-in-chat").first().click();
  await expect(page.getByTestId("factory-phase-bar")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByTestId("factory-phase-discovery").click();
  await expect(page.getByTestId("factory-phase-discovery")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function assertFactoryChrome(page: Page): Promise<void> {
  await expect(page.getByTestId("chat-input-container")).toHaveCount(0);
  await expect(page.getByTestId("factory-phase-comments")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("already approved");
  await expect(page.locator("body")).not.toContainText(
    "Which name should the page use",
  );
}

async function openQuestionId(page: Page): Promise<string | null> {
  const card = page
    .locator('[data-testid^="hitl-question-"]')
    .filter({ hasText: "Status: open" })
    .first();
  if (!(await card.isVisible().catch(() => false))) return null;
  const testId = await card.getAttribute("data-testid");
  return testId?.replace("hitl-question-", "") ?? null;
}

async function failIfCursorStopped(page: Page, phase: Phase): Promise<void> {
  const stopped = page.getByText(
    /Cursor run (errored|cancelled|expired|stopped)/i,
  );
  if (
    await stopped
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error(
      `${phaseLabel(phase)} stopped before a person could answer: ${await stopped.first().innerText()}`,
    );
  }
}

async function waitForBeat(
  pm: Page,
  dev: Page,
  phase: Phase,
): Promise<"summary" | { id: string }> {
  const summary = new RegExp(`${phaseLabel(phase)} summary`, "i");
  const started = Date.now();
  while (Date.now() - started < QUESTION_WAIT_MS) {
    await failIfCursorStopped(pm, phase);
    await failIfCursorStopped(dev, phase);
    if (
      (await pm
        .getByText(summary)
        .first()
        .isVisible()
        .catch(() => false)) &&
      (await dev
        .getByText(summary)
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      return "summary";
    }
    const id = (await openQuestionId(pm)) ?? (await openQuestionId(dev));
    if (id) return { id };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${phaseLabel(phase)} did not reach a role request or a summary.`,
  );
}

async function showSplit(
  pm: Page,
  dev: Page,
  id: string,
): Promise<{ target: Page; other: Page; role: string; body: string }> {
  const pmForm = pm.getByTestId(`hitl-answer-${id}`);
  const devForm = dev.getByTestId(`hitl-answer-${id}`);
  await expect(pmForm.or(devForm)).toBeVisible({ timeout: 30_000 });
  const pmAnswers = await pmForm.isVisible().catch(() => false);
  const devAnswers = await devForm.isVisible().catch(() => false);
  if (pmAnswers === devAnswers) {
    throw new Error(`Question ${id} was offered to both roles or to neither.`);
  }
  const target = pmAnswers ? pm : dev;
  const other = pmAnswers ? dev : pm;
  const role = pmAnswers ? "project-manager" : "developer";
  await expect(target.getByTestId(`hitl-body-${id}`)).toBeVisible();
  await expect(other.getByTestId(`hitl-body-${id}`)).toHaveCount(0);
  await expect(other.getByTestId(`hitl-answer-${id}`)).toHaveCount(0);
  await expect(other.getByTestId(`hitl-wait-${id}`)).toBeVisible();
  await expect(other.getByTestId(`hitl-wait-${id}`)).toContainText(
    role === "project-manager" ? "Project Manager" : "Developer",
  );
  const body = await target
    .getByTestId(`hitl-body-${id}`)
    .evaluate((element) => element.textContent ?? "");
  if (!body.trim()) throw new Error(`Question ${id} has an empty body.`);
  return { target, other, role, body };
}

async function waitForFollowUp(
  appId: number,
  phase: Phase,
  body: string,
  answer: string,
): Promise<string> {
  const hash = promptHash(body, answer);
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const rows = await readRowsSoon(
      `SELECT run_id AS runId
       FROM factory_host_runs
       WHERE app_id = ? AND phase = ? AND prompt_hash = ?`,
      [appId, phase, hash],
    );
    const runId = rows[0]?.runId;
    if (typeof runId === "string") return runId;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${phaseLabel(phase)} follow-up prompt did not contain the submitted answer.`,
  );
}

async function selectPhase(page: Page, phase: Phase): Promise<void> {
  const button = page.getByTestId(`factory-phase-${phase}`);
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await assertFactoryChrome(page);
}

test("two signed-in browsers walk Discovery, Implementation, and Delivery", async ({
  browser,
}) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  let manager: { page: Page; close: () => Promise<void> } | undefined;
  let developer: { page: Page; close: () => Promise<void> } | undefined;
  try {
    const projectManager = await factoryAccount("project-manager");
    const developerAccount = await factoryAccount("developer");
    manager = await signedInPage(
      browser,
      projectManager.userId,
      projectManager.organizationId,
      "project-manager",
    );
    developer = await signedInPage(
      browser,
      developerAccount.userId,
      developerAccount.organizationId,
      "developer",
    );
    const pm = manager.page;
    const dev = developer.page;
    await expect
      .poll(() => membershipRole(pm, projectManager.organizationId), {
        timeout: 30_000,
      })
      .toBe("project-manager");
    await expect
      .poll(() => membershipRole(dev, developerAccount.organizationId), {
        timeout: 30_000,
      })
      .toBe("developer");

    const appName = `Bridge Pass ${Date.now().toString().slice(-6)}`;
    const created = await pm.evaluate(async (name: string) => {
      const electron = (
        window as unknown as {
          electron: {
            ipcRenderer: {
              invoke: (
                channel: string,
                args: { name: string },
              ) => Promise<{ app: { id: number }; chatId: number }>;
            };
          };
        }
      ).electron;
      return electron.ipcRenderer.invoke("create-app", { name });
    }, appName);
    evidence.appId = created.app.id;

    await openFactoryApp(pm, appName);
    await openFactoryApp(dev, appName);
    for (const page of [pm, dev]) {
      await assertFactoryChrome(page);
      await expect(page.getByTestId("factory-phase-discovery")).toBeEnabled();
      await expect(
        page.getByTestId("factory-phase-implementation"),
      ).toBeDisabled();
      await expect(page.getByTestId("factory-phase-delivery")).toBeDisabled();
    }

    await expect
      .poll(
        async () =>
          (
            await readRowsSoon(
              `SELECT run_id AS runId FROM factory_host_runs WHERE app_id = ? AND phase = 'discovery'`,
              [created.app.id],
            )
          ).length,
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);

    await walkPhase(pm, dev, created.app.id, "discovery", true);
    for (const page of [pm, dev]) {
      await expect(page.getByTestId("factory-phase-delivery")).toBeDisabled();
    }
    await approveAndOpenNext(pm, dev, "implementation");

    await walkPhase(pm, dev, created.app.id, "implementation", true);
    await expect(pm.getByTestId("factory-phase-delivery")).toBeDisabled();
    await expect(dev.getByTestId("factory-phase-delivery")).toBeDisabled();
    await approveAndOpenNext(pm, dev, "delivery");

    await walkPhase(pm, dev, created.app.id, "delivery", false);
    const pmDelivery = pm.getByTestId("factory-phase-continue");
    const devDelivery = dev.getByTestId("factory-phase-continue");
    await expect(pmDelivery).toBeEnabled();
    await expect(devDelivery).toBeDisabled();
    await expect(pmDelivery).toContainText("Approve delivery");
    await pmDelivery.click();
    await expect
      .poll(
        async () =>
          (
            await readRowsSoon(
              `SELECT phase FROM factory_phase_approvals WHERE app_id = ?`,
              [created.app.id],
            )
          ).map((row) => row.phase),
        { timeout: 60_000 },
      )
      .toEqual(
        expect.arrayContaining(["discovery", "implementation", "delivery"]),
      );
    await expect(dev.getByTestId("factory-phase-continue")).toBeDisabled();
  } finally {
    const snapshot = await snapshotEvidence(evidence.appId).catch((error) => ({
      error: error instanceof Error ? error.message : "evidence unread",
    }));
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "evidence.json"),
      JSON.stringify(
        {
          appId: evidence.appId,
          leftAppWhileQuestionOpen: evidence.leftAppWhileQuestionOpen,
          questions: evidence.questions.map((question) => ({
            id: question.id,
            phase: question.phase,
            role: question.role,
            resumeRunId: question.resumeRunId,
          })),
          ...snapshot,
        },
        null,
        2,
      ),
    );
    await manager?.close();
    await developer?.close();
  }
});

async function walkPhase(
  pm: Page,
  dev: Page,
  appId: number,
  phase: Phase,
  requireQuestion: boolean,
): Promise<void> {
  await selectPhase(pm, phase);
  await selectPhase(dev, phase);
  let sawQuestion = false;
  for (let turn = 0; turn < 6; turn += 1) {
    const beat = await waitForBeat(pm, dev, phase);
    if (beat === "summary") {
      if (requireQuestion && !sawQuestion) {
        throw new Error(
          `${phaseLabel(phase)} reached a summary before a role request.`,
        );
      }
      await assertFactoryChrome(pm);
      await assertFactoryChrome(dev);
      return;
    }
    sawQuestion = true;
    let split = await showSplit(pm, dev, beat.id);
    if (!evidence.leftAppWhileQuestionOpen) {
      const returnUrl = dev.url();
      await dev.goto(BRIDGE_URL);
      await expect(pm.getByTestId(`hitl-question-${beat.id}`)).toBeVisible();
      await dev.goto(returnUrl);
      await expect(dev.getByTestId("title-bar-user-button")).toBeVisible({
        timeout: 60_000,
      });
      await expect(dev.getByTestId("factory-phase-bar")).toBeVisible();
      evidence.leftAppWhileQuestionOpen = true;
      split = await showSplit(pm, dev, beat.id);
    }
    const answer = answerFromBody(split.body);
    const form = split.target.getByTestId(`hitl-answer-${beat.id}`);
    await form.getByRole("textbox").fill(answer);
    await form.getByRole("button", { name: "Submit answer" }).click();
    await expect(form).toHaveCount(0, { timeout: 60_000 });
    await expect(split.other.getByTestId(`hitl-body-${beat.id}`)).toHaveCount(
      0,
    );
    const resumeRunId = await waitForFollowUp(appId, phase, split.body, answer);
    evidence.questions.push({
      id: beat.id,
      phase,
      role: split.role,
      resumeRunId,
    });
  }
  throw new Error(`${phaseLabel(phase)} kept asking after six answers.`);
}

async function approveAndOpenNext(
  pm: Page,
  dev: Page,
  next: "implementation" | "delivery",
): Promise<void> {
  const pmContinue = pm.getByTestId("factory-phase-continue");
  const devContinue = dev.getByTestId("factory-phase-continue");
  await expect(pmContinue).toBeEnabled();
  await expect(devContinue).toBeDisabled();
  await expect(pmContinue).toContainText("Approve and continue");
  await pmContinue.click();
  await expect(pm.getByTestId("chat-input-container")).toHaveCount(0);
  await selectPhase(pm, next);
  await selectPhase(dev, next);
}

async function snapshotEvidence(appId: number | null): Promise<{
  runs: Array<{ runId: unknown; phase: unknown; idempotencyKey: unknown }>;
  questions: Array<{
    id: unknown;
    phase: unknown;
    role: unknown;
    status: unknown;
    runId: unknown;
  }>;
  answers: Array<{ id: unknown; questionId: unknown }>;
  approvals: Array<{ phase: unknown; roleId: unknown }>;
}> {
  if (appId == null) {
    return { runs: [], questions: [], answers: [], approvals: [] };
  }
  const runs = await readRowsSoon(
    `SELECT run_id AS runId, phase, idempotency_key AS idempotencyKey
     FROM factory_host_runs WHERE app_id = ? ORDER BY created_at`,
    [appId],
  );
  const questions = await readRowsSoon(
    `SELECT id, phase, target_role_id AS role, status, run_id AS runId
     FROM hitl_questions WHERE app_id = ? ORDER BY created_at`,
    [appId],
  );
  const answers = await readRowsSoon(
    `SELECT hitl_answers.id AS id, hitl_answers.question_id AS questionId
     FROM hitl_answers
     JOIN hitl_questions ON hitl_questions.id = hitl_answers.question_id
     WHERE hitl_questions.app_id = ?`,
    [appId],
  );
  const approvals = await readRowsSoon(
    `SELECT phase, role_id AS roleId FROM factory_phase_approvals WHERE app_id = ?`,
    [appId],
  );
  return { runs, questions, answers, approvals };
}
