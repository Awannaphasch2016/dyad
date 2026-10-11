import { clerk } from "@clerk/testing/playwright";
import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  ROLES,
  openWalkthrough,
  projectSnapshot,
  signInAs,
  writeReport,
} from "./walkthrough";

// Same strings as P3_IDEMPOTENCY_KEY and P3_QUESTION_BODY in
// scripts/doppler/bolt-reset-project.mjs. Reset deletes this question before
// the browser checks, and this test deletes it again when it finishes.
const P3_IDEMPOTENCY_KEY = "p3:plan-approve";
const P3_QUESTION_BODY = "P3 plan question: which name should the page use?";
const WALKTHROUGH_APP_ID = "bolt-walkthrough";

interface HitlQuestion {
  id: string;
  stepId: string;
  targetRoleId: string;
  status: string;
  body: string | null;
  canAnswer: boolean;
}

function walkthroughOrigin() {
  return (
    process.env.WALKTHROUGH_URL ??
    "https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev"
  );
}

async function neon(query: string, params: string[]) {
  const databaseUrl = (process.env.WEWEBPLUS_DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new Error("Question store is unavailable.");
  const endpoint = new URL(databaseUrl);
  const response = await fetch(`https://${endpoint.host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": databaseUrl,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok) {
    throw new Error(`Question store ${response.status}`);
  }
}

async function deleteP3Question() {
  await neon(
    "delete from wewebplus.answers where question_id in (select id from wewebplus.questions where idempotency_key = $1)",
    [P3_IDEMPOTENCY_KEY],
  );
  await neon("delete from wewebplus.questions where idempotency_key = $1", [
    P3_IDEMPOTENCY_KEY,
  ]);
}

async function postP3Question(phase: string) {
  const token = (process.env.GAS_CITY_HOST_BRIDGE_TOKEN ?? "").trim();
  if (!token) throw new Error("Machine token is absent.");
  const response = await fetch(new URL("/api/hitl", walkthroughOrigin()), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phase,
      appId: WALKTHROUGH_APP_ID,
      runId: "p3-role-visibility",
      stepId: "plan-approve",
      targetRoleId: "project-manager",
      body: P3_QUESTION_BODY,
      idempotencyKey: P3_IDEMPOTENCY_KEY,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
  };
  if ((response.status !== 201 && response.status !== 200) || !payload.id) {
    throw new Error(
      `P3 question post ${response.status} ${payload.error ?? ""}`.trim(),
    );
  }
  return payload.id;
}

async function sessionHitl(page: Page, phase: string) {
  return page.evaluate(async (phaseName) => {
    const token = await window.Clerk?.session?.getToken();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const response = await fetch(
      `/api/hitl?phase=${encodeURIComponent(phaseName)}`,
      { headers },
    );
    let questions: HitlQuestion[] = [];
    try {
      const payload = (await response.json()) as { questions?: HitlQuestion[] };
      questions = payload.questions ?? [];
    } catch {
      questions = [];
    }
    return { status: response.status, questions };
  }, phase);
}

async function answerStatus(page: Page, questionId: string) {
  return page.evaluate(async (id) => {
    const token = await window.Clerk?.session?.getToken();
    const response = await fetch(`/api/hitl/${id}/answers`, {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: "not this role" }),
    });
    return response.status;
  }, questionId);
}

async function signedIn(browser: Browser, userId: string) {
  // A fresh context does not inherit the project base URL. Both roles need
  // their own cookie jar and the walkthrough origin.
  const device = devices["Desktop Chrome"];
  const context = await browser.newContext({
    userAgent: device.userAgent,
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    baseURL: walkthroughOrigin(),
    recordVideo: { dir: "test-results" },
  });
  const page = await context.newPage();
  await openWalkthrough(context, page);
  await signInAs(page, userId);
  return { context, page };
}

test("p3: a project-manager question is visible only to that role", async ({
  browser,
}) => {
  test.setTimeout(3 * 60 * 1000);
  const pmRole = ROLES.pm;
  const devRole = ROLES.dev;
  test.skip(
    !pmRole.userId || !devRole.userId,
    "walkthrough user ids are absent",
  );

  let pm: { context: BrowserContext; page: Page } | null = null;
  let dev: { context: BrowserContext; page: Page } | null = null;
  try {
    await deleteP3Question();
    pm = await signedIn(browser, pmRole.userId);
    await expect(pm.page.getByTestId("bolt-account")).toContainText(
      pmRole.label,
    );
    const pmProject = await projectSnapshot(pm.page);
    expect(pmProject.status).toBe(200);
    const phase = String(pmProject.body?.phase ?? "");
    expect(["discovery", "implementation", "delivery"]).toContain(phase);

    const questionId = await postP3Question(phase);
    dev = await signedIn(browser, devRole.userId);
    await expect(dev.page.getByTestId("bolt-account")).toContainText(
      devRole.label,
    );
    const devProject = await projectSnapshot(dev.page);
    expect(devProject.status).toBe(200);
    expect(devProject.body?.phase).toBe(phase);
    expect(pmProject.body?.roleId).toBe("project-manager");
    expect(devProject.body?.roleId).toBe("developer");

    const pmHitl = await sessionHitl(pm.page, phase);
    const devHitl = await sessionHitl(dev.page, phase);
    expect(pmHitl.status).toBe(200);
    expect(devHitl.status).toBe(200);
    const pmQuestion = pmHitl.questions.find(
      (question) => question.id === questionId,
    );
    const devQuestion = devHitl.questions.find(
      (question) => question.id === questionId,
    );
    expect(pmQuestion?.stepId).toBe("plan-approve");
    expect(pmQuestion?.targetRoleId).toBe("project-manager");
    expect(pmQuestion?.status).toBe("open");
    expect(pmQuestion?.body).toBe(P3_QUESTION_BODY);
    expect(pmQuestion?.canAnswer).toBe(true);
    expect(devQuestion?.stepId).toBe("plan-approve");
    expect(devQuestion?.status).toBe("open");
    expect(devQuestion?.body).toBeNull();
    expect(devQuestion?.canAnswer).toBe(false);

    expect(await answerStatus(dev.page, questionId)).toBe(403);
    const stillOpen = await sessionHitl(pm.page, phase);
    expect(
      stillOpen.questions.find((question) => question.id === questionId)
        ?.status,
    ).toBe("open");

    // The posted question must not leak into the developer's page. The
    // deployed client paints the shared project gate from /api/project.
    await expect(dev.page.getByText(P3_QUESTION_BODY)).toHaveCount(0);
    const implementationBody = "Approve the Implementation review.";
    const painted = Array.isArray(pmProject.body?.questions)
      ? (pmProject.body.questions as HitlQuestion[])
      : [];
    const paintedOpen = painted.find((question) => question.status === "open");
    if (paintedOpen) {
      await expect(pm.page.getByTestId("shared-gate")).toContainText(
        "Waiting on the Developer.",
      );
      await expect(pm.page.getByText(implementationBody)).toHaveCount(0);
      await expect(dev.page.getByTestId("shared-gate")).toContainText(
        implementationBody,
      );
      expect(paintedOpen.body).toBeNull();
      expect(paintedOpen.canAnswer).toBe(false);
    }
    await pm.page.screenshot({ path: "artifacts/p3-pm.png", fullPage: true });
    await dev.page.screenshot({
      path: "artifacts/p3-dev.png",
      fullPage: true,
    });

    writeReport("p3-role-visibility", {
      summary: `pm session sees the plan-approve body and can answer; developer session sees status open with the body hidden and is refused (403); shared phase ${phase}; question ${questionId}`,
      phase,
      questionId,
      pmBody: pmQuestion?.body ?? null,
      devBody: devQuestion?.body ?? null,
      devCanAnswer: false,
      devAnswerStatus: 403,
      paintedOpenQuestion: paintedOpen?.stepId ?? null,
    });

    await clerk.signOut({ page: pm.page });
    await clerk.signOut({ page: dev.page });
  } finally {
    await pm?.context.close();
    await dev?.context.close();
    await deleteP3Question();
  }
});
