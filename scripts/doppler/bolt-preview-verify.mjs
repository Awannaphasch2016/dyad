// Walk the deployed Bolt preview as the Project Manager and the Developer.
// Expected labels below are the testing contract. Do not change them to make a
// failing run pass. This run resets the shared bolt-walkthrough project.

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { neonSqlEndpoint } from "./bolt-hitl.mjs";
import { redact } from "./bolt-project.mjs";
import { discoveryReady } from "./bolt-workflow.mjs";
import {
  WALKTHROUGH_APP_ID,
  WALKTHROUGH_CHAT_ID,
  WALKTHROUGH_ORIGIN,
  clerkKeyKind,
  loadDirectory,
  matchGateAccounts,
  sharedOrganization,
} from "./bolt-sign-in.mjs";

export const TOKEN_TTL_SECONDS = 600;

export const WALKTHROUGH_EXPECTATIONS = {
  projectManager: "Wewebplus · Project Manager",
  developer: "Wewebplus · Developer",
  placeholder: "Describe the page",
  discoveryPrompt:
    "A one-page site for North Pier Fish with the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.",
  discoveryAnswer: "Yes. The page name is North Pier Fish.",
  discoverySentence: "Welcome to North Pier Fish.",
  discoveryContents:
    "The page shows the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.",
  previewPhrases: [
    "North Pier Fish",
    "fish and chips",
    "clam chowder",
    "iced tea",
  ],
  moveToImplementation: "Move to Implementation",
  waitingOnProjectManager: "Waiting on the Project Manager.",
  waitingOnDeveloper: "Waiting on the Developer.",
  implementationQuestion: "Approve the Implementation review.",
  answer: "The menu is on the page.",
  moveToDelivery: "Move to Delivery",
  approveDelivery: "Approve delivery",
  downloadName: "factory-document.html",
};

export const FUNCTIONAL_STEPS = [
  "reset-project",
  "sign-in-project-manager",
  "sign-in-developer",
  "discovery-role-isolation",
  "developer-cannot-send",
  "send-discovery-description",
  "move-to-implementation",
  "manager-cannot-answer",
  "developer-answers",
  "move-to-delivery",
  "developer-cannot-approve-delivery",
  "approve-delivery",
  "downloads-match",
];

const UI_TIMEOUT_MS = 30_000;
const DISCOVERY_REPLY_MS = 1_080_000;
const PREVIEW_WAIT_MS = 120_000;

export function resetStatements(
  appId = WALKTHROUGH_APP_ID,
  chatId = WALKTHROUGH_CHAT_ID,
) {
  return [
    {
      query:
        "delete from wewebplus.answers where question_id in (select id from wewebplus.questions where app_id = $1)",
      params: [appId],
    },
    {
      query: "delete from wewebplus.questions where app_id = $1",
      params: [appId],
    },
    {
      query: "delete from wewebplus.messages where chat_id = $1",
      params: [chatId],
    },
    {
      query:
        "update wewebplus.project_state set phase = 'discovery', delivered_at = null, document_html = null, busy = false where app_id = $1",
      params: [appId],
    },
  ];
}

export function signInTokenBody({
  userId,
  orgId,
  expiresInSeconds = TOKEN_TTL_SECONDS,
}) {
  if (!String(userId ?? "").trim() || !String(orgId ?? "").trim()) {
    throw new Error("Sign-in token needs a user and organization");
  }
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 60 ||
    expiresInSeconds > TOKEN_TTL_SECONDS
  ) {
    throw new Error("Sign-in token expiry must be between 60 and 600 seconds");
  }
  return {
    user_id: userId,
    expires_in_seconds: expiresInSeconds,
    org_id: orgId,
  };
}

export function assertDevelopmentSecret(secret) {
  const kind = clerkKeyKind(secret);
  if (kind === "live") throw new Error("clerk_secret=live");
  if (
    kind !== "test" ||
    !String(secret ?? "")
      .trim()
      .startsWith("sk_test_")
  ) {
    throw new Error("clerk_secret=not_test");
  }
  return "sk_test";
}

export function redactVerificationError(value) {
  return redact(value)
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9+/=_-]+/g, "clerk_redacted")
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, "jwt_redacted");
}

export function createReport() {
  return {
    functional: "not_run",
    failedStep: null,
    steps: FUNCTIONAL_STEPS.map((name) => ({ name, status: "not_run" })),
    unverified: [],
    error: null,
  };
}

export function markStep(report, name, status) {
  const step = report.steps.find((item) => item.name === name);
  if (!step) throw new Error(`Unknown verification step ${name}`);
  step.status = status;
  if (status === "failed") {
    report.functional = "failed";
    report.failedStep = name;
  }
}

export function classifyPreview(snapshot) {
  const src = String(snapshot?.src ?? "").trim();
  const text = String(snapshot?.text ?? "");
  const readable =
    Boolean(src) &&
    src !== "about:blank" &&
    snapshot?.readable === true &&
    text.trim().length > 0;
  if (!readable) {
    return {
      layer: "generated-website",
      status: "failed",
      reason: "The preview iframe had no readable document.",
    };
  }
  const missing = WALKTHROUGH_EXPECTATIONS.previewPhrases.filter(
    (phrase) => !text.toLowerCase().includes(phrase.toLowerCase()),
  );
  if (missing.length > 0) {
    return {
      layer: "generated-website",
      status: "failed",
      reason: `The preview was missing: ${missing.join(", ")}.`,
    };
  }
  return {
    layer: "generated-website",
    status: "passed",
    reason: "The preview contained the page name and the three menu items.",
  };
}

export function layersNotRun() {
  return [
    {
      layer: "visual-regression",
      status: "not_run",
      reason:
        "Screenshots are evidence. This run does not compare them to a baseline.",
    },
    {
      layer: "agentic-ux",
      status: "not_run",
      reason:
        "A model's opinion of the layout is not a pass gate, and no separate UX checker is configured.",
    },
  ];
}

export function finishReport(report, preview) {
  const required = report.steps.every((step) => step.status === "passed");
  if (report.functional !== "failed") {
    if (!required) {
      report.functional = "not_run";
    } else if (preview?.status === "passed") {
      report.functional = "passed";
    } else {
      report.functional = "failed";
      report.failedStep = "generated-website";
    }
  }
  report.unverified = [preview, ...layersNotRun()];
  return report;
}

export function renderSummary(report) {
  const lines = [
    "resets_shared_project=bolt-walkthrough",
    `functional=${report.functional}`,
  ];
  if (report.failedStep) lines.push(`failed_step=${report.failedStep}`);
  for (const step of report.steps) lines.push(`${step.name}=${step.status}`);
  for (const item of report.unverified) {
    lines.push(`${item.layer}=${item.status}`);
  }
  if (report.error) lines.push(`error=${report.error}`);
  return lines.join("\n");
}

function evidenceDirectory(env) {
  return env.VERIFICATION_EVIDENCE_DIR ?? "verification-evidence";
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS === "true" && value) {
    console.log(`::add-mask::${value}`);
  }
}

async function neonExecute(databaseUrl, query, params) {
  const response = await fetch(neonSqlEndpoint(databaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": databaseUrl,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!response.ok) throw new Error(`project_reset=${response.status}`);
}

async function resetProject(databaseUrl) {
  for (const statement of resetStatements()) {
    await neonExecute(databaseUrl, statement.query, statement.params);
  }
}

async function resolveAccounts(secret) {
  const directory = await loadDirectory(secret);
  const matched = matchGateAccounts(directory.accounts);
  if (!matched.projectManager || !matched.developer) {
    throw new Error("gate_accounts=missing");
  }
  const organization = sharedOrganization(
    matched.projectManager,
    matched.developer,
    directory.organizations,
  );
  if (!organization) throw new Error("gate_org=missing");
  return {
    organizationId: organization.id,
    projectManagerId: matched.projectManager.id,
    developerId: matched.developer.id,
  };
}

async function mintSignInToken(secret, body) {
  const response = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`sign_in_token=${response.status}`);
  const payload = await response.json();
  const token = payload?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("sign_in_token=empty");
  }
  mask(token);
  return token;
}

async function launchChromium() {
  const override = process.env.PLAYWRIGHT_MODULE;
  const loaded = override
    ? await import(pathToFileURL(override).href)
    : await import("playwright");
  return loaded.chromium.launch({ headless: true });
}

async function openSignedIn(page, origin, ticket, label) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean(window.Clerk && typeof window.Clerk.load === "function"),
    null,
    { timeout: 45_000 },
  );
  let redeemed = false;
  try {
    redeemed = await page.evaluate(async (ticket) => {
      const clerk = window.Clerk;
      if (!clerk) return false;
      if (!clerk.loaded) await clerk.load();
      const attempt = await clerk.client.signIn.create({
        strategy: "ticket",
        ticket,
      });
      const sessionId =
        attempt?.createdSessionId || clerk.client?.signIn?.createdSessionId;
      if (!sessionId) return false;
      await clerk.setActive({ session: sessionId });
      return true;
    }, ticket);
  } catch {
    redeemed = false;
  }
  if (!redeemed) throw new Error("Clerk ticket sign-in failed");
  await page.getByTestId("bolt-account").waitFor({ timeout: UI_TIMEOUT_MS });
  const text = await page.getByTestId("bolt-account").innerText();
  if (!text.includes(label)) {
    throw new Error(`Account label was ${text.trim()}`);
  }
}

async function waitForGateText(page, text) {
  await page.waitForFunction(
    (expected) => {
      const gate = document.querySelector('[data-testid="shared-gate"]');
      return Boolean(gate?.textContent?.includes(expected));
    },
    text,
    { timeout: UI_TIMEOUT_MS },
  );
}

async function assertNoTransition(page) {
  const count = await page.getByTestId("shared-gate-transition").count();
  if (count !== 0) throw new Error("A role saw a transition it does not own");
}

async function shoot(page, dir, name) {
  try {
    await page.screenshot({ path: join(dir, name), fullPage: true });
  } catch {
    // A missing picture does not change the assertion result.
  }
}

async function step(report, name, fn) {
  try {
    await fn();
    markStep(report, name, "passed");
  } catch (error) {
    markStep(report, name, "failed");
    throw error;
  }
}

async function assertDeveloperCannotSend(page) {
  const chatPosts = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && request.url().includes("/api/chat")) {
      chatPosts.push(request.url());
    }
  };
  page.on("request", onRequest);
  try {
    const typed = await page.evaluate((placeholder) => {
      const box = document.querySelector(
        `textarea[placeholder="${placeholder}"]`,
      );
      if (!(box instanceof HTMLTextAreaElement)) return false;
      box.focus();
      return true;
    }, WALKTHROUGH_EXPECTATIONS.placeholder);
    if (!typed) throw new Error("Discovery composer was missing");
    await page.keyboard.type("This prompt must not be stored.");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    if (chatPosts.length > 0) {
      throw new Error("Developer stored a Discovery prompt");
    }
    const blocked = await page
      .getByText("This prompt must not be stored.", { exact: true })
      .count();
    if (blocked !== 0) throw new Error("Developer stored a Discovery prompt");
  } finally {
    page.off("request", onRequest);
  }
  const status = await page.evaluate(async () => {
    const token = await window.Clerk?.session?.getToken();
    if (!token) return 0;
    const response = await fetch("/api/project", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        command: "record",
        messages: [
          {
            id: "verify-blocked",
            role: "user",
            content: "This prompt must not be stored.",
          },
        ],
      }),
    });
    return response.status;
  });
  if (status !== 403) throw new Error(`Developer record returned ${status}`);
}

async function captureDownload(page, file) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: UI_TIMEOUT_MS }),
    page.getByTestId("shared-download").click(),
  ]);
  if (download.suggestedFilename() !== WALKTHROUGH_EXPECTATIONS.downloadName) {
    throw new Error("Download filename was not factory-document.html");
  }
  await download.saveAs(file);
  return readFileSync(file, "utf8");
}

async function projectSnapshot(page) {
  return page.evaluate(async () => {
    const token = await window.Clerk?.session?.getToken();
    const response = await fetch("/api/project", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return response.json();
  });
}

async function sendComposer(page, text) {
  const box = page.getByPlaceholder(WALKTHROUGH_EXPECTATIONS.placeholder);
  await box.fill(text);
  await box.press("Enter");
}

async function sendDiscoveryDescription(page, dir) {
  const prompt = WALKTHROUGH_EXPECTATIONS.discoveryPrompt;
  const answers = [
    WALKTHROUGH_EXPECTATIONS.discoveryAnswer,
    WALKTHROUGH_EXPECTATIONS.discoverySentence,
    WALKTHROUGH_EXPECTATIONS.discoveryContents,
  ];
  await sendComposer(page, prompt);
  const deadline = Date.now() + DISCOVERY_REPLY_MS;
  let sent = 0;
  while (Date.now() < deadline) {
    const snapshot = await projectSnapshot(page);
    const messages = snapshot?.messages ?? [];
    const stored = messages.some(
      (message) =>
        message?.role === "user" &&
        String(message.content ?? "").includes(prompt),
    );
    if (stored && discoveryReady(messages)) {
      await shoot(page, dir, "discovery-reply-project-manager.png");
      return;
    }
    const assistantCount = messages.filter(
      (message) =>
        message?.role === "assistant" && String(message.content ?? "").trim(),
    ).length;
    if (stored && assistantCount > sent && sent < answers.length) {
      const answer = answers[sent];
      sent += 1;
      await sendComposer(page, answer);
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("Discovery still has a question.");
}

async function readPreview(page) {
  const frame = page.locator('iframe[title="preview"]');
  const deadline = Date.now() + PREVIEW_WAIT_MS;
  let src = "";
  while (Date.now() < deadline) {
    if ((await frame.count()) > 0) {
      src = (await frame.first().getAttribute("src")) ?? "";
      if (src && src !== "about:blank") break;
    }
    await page.waitForTimeout(2000);
  }
  if (!src || src === "about:blank") return { src, text: "", readable: false };
  try {
    const text = await page
      .frameLocator('iframe[title="preview"]')
      .locator("body")
      .innerText({ timeout: 15_000 });
    return { src, text, readable: true };
  } catch {
    return { src, text: "", readable: false };
  }
}

async function walk(report, pages, dir) {
  const { projectManager: pm, developer: dev } = pages;
  const expected = WALKTHROUGH_EXPECTATIONS;

  await step(report, "discovery-role-isolation", async () => {
    await pm.getByPlaceholder(expected.placeholder).waitFor({
      timeout: UI_TIMEOUT_MS,
    });
    const deadline = Date.now() + UI_TIMEOUT_MS;
    let open = false;
    while (Date.now() < deadline) {
      const snapshot = await projectSnapshot(pm);
      if (
        snapshot?.phase === "discovery" &&
        snapshot.canSend === true &&
        snapshot.canTransition === false
      ) {
        open = true;
        break;
      }
      await pm.waitForTimeout(500);
    }
    if (!open) {
      throw new Error(
        "Move to Implementation was available before the Discovery summary",
      );
    }
    await assertNoTransition(pm);
    await waitForGateText(dev, expected.waitingOnProjectManager);
    await assertNoTransition(dev);
    await shoot(pm, dir, "discovery-project-manager.png");
    await shoot(dev, dir, "discovery-developer.png");
  });

  await step(report, "developer-cannot-send", () =>
    assertDeveloperCannotSend(dev),
  );

  await step(report, "send-discovery-description", () =>
    sendDiscoveryDescription(pm, dir),
  );

  await step(report, "move-to-implementation", async () => {
    await pm.getByTestId("shared-gate-transition").click();
    await waitForGateText(dev, expected.implementationQuestion);
    await waitForGateText(pm, expected.waitingOnDeveloper);
    await shoot(dev, dir, "implementation-question-developer.png");
    await shoot(pm, dir, "implementation-waiting-project-manager.png");
  });

  await step(report, "manager-cannot-answer", async () => {
    if ((await pm.getByLabel("Implementation answer").count()) !== 0) {
      throw new Error("Project Manager was offered the Implementation answer");
    }
    if ((await dev.getByLabel("Implementation answer").count()) !== 1) {
      throw new Error("Developer did not get the Implementation answer");
    }
  });

  await step(report, "developer-answers", async () => {
    await dev.getByLabel("Implementation answer").fill(expected.answer);
    await dev.getByRole("button", { name: "Submit answer" }).click();
    await dev.getByTestId("shared-gate-transition").waitFor({
      timeout: UI_TIMEOUT_MS,
    });
    const label = await dev.getByTestId("shared-gate-transition").innerText();
    if (label.trim() !== expected.moveToDelivery) {
      throw new Error("Developer did not reach Move to Delivery");
    }
    if ((await dev.getByLabel("Implementation answer").count()) !== 0) {
      throw new Error("Implementation answer stayed open");
    }
  });

  await step(report, "move-to-delivery", async () => {
    await dev.getByTestId("shared-gate-transition").click();
    await waitForGateText(pm, expected.approveDelivery);
    await shoot(pm, dir, "delivery-project-manager.png");
  });

  await step(report, "developer-cannot-approve-delivery", async () => {
    await pageWaitForDeliveryLock(dev);
    await shoot(dev, dir, "delivery-waiting-developer.png");
  });

  await step(report, "approve-delivery", async () => {
    const label = await pm.getByTestId("shared-gate-transition").innerText();
    if (label.trim() !== expected.approveDelivery) {
      throw new Error("Project Manager did not see delivery approval");
    }
    await pm.getByTestId("shared-gate-transition").click();
    await pm.getByTestId("shared-download").waitFor({ timeout: UI_TIMEOUT_MS });
    await dev
      .getByTestId("shared-download")
      .waitFor({ timeout: UI_TIMEOUT_MS });
    await pm.waitForFunction(
      () => document.querySelector('[data-testid="shared-gate"]') == null,
      null,
      { timeout: UI_TIMEOUT_MS },
    );
    await shoot(pm, dir, "delivered-project-manager.png");
    await shoot(dev, dir, "delivered-developer.png");
  });

  await step(report, "downloads-match", async () => {
    const managerHtml = await captureDownload(
      pm,
      join(dir, "project-manager-factory-document.html"),
    );
    const developerHtml = await captureDownload(
      dev,
      join(dir, "developer-factory-document.html"),
    );
    if (managerHtml !== developerHtml) {
      throw new Error("Downloads did not match");
    }
    const downloadText = managerHtml.toLowerCase();
    if (
      !managerHtml.includes("<h1>Delivered</h1>") ||
      !managerHtml.includes(expected.answer) ||
      !managerHtml.includes(expected.discoveryPrompt) ||
      !expected.previewPhrases.every((phrase) =>
        downloadText.includes(phrase.toLowerCase()),
      )
    ) {
      throw new Error("Download did not contain the typed Discovery text");
    }
  });
}

async function pageWaitForDeliveryLock(page) {
  await page.waitForFunction(
    (waiting) => {
      const gate = document.querySelector('[data-testid="shared-gate"]');
      if (!gate?.textContent?.includes(waiting)) return false;
      return (
        gate.querySelector('[data-testid="shared-gate-transition"]') == null
      );
    },
    WALKTHROUGH_EXPECTATIONS.waitingOnProjectManager,
    { timeout: UI_TIMEOUT_MS },
  );
}

function writeReport(dir, report, env) {
  const summary = renderSummary(report);
  writeFileSync(
    join(dir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(dir, "summary.txt"), `${summary}\n`);
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

export async function runVerification(env = process.env) {
  const report = createReport();
  const dir = evidenceDirectory(env);
  mkdirSync(dir, { recursive: true });
  let browser;
  let projectManagerContext;
  let developerContext;
  let projectManagerPage;
  let developerPage;
  let tracing = false;
  let preview = {
    layer: "generated-website",
    status: "not_run",
    reason: "The walk did not reach the preview.",
  };
  try {
    const secret = String(env.CLERK_SECRET_KEY ?? "");
    const databaseUrl = String(env.WEWEBPLUS_DATABASE_URL ?? "").trim();
    console.log(`clerk_secret=${assertDevelopmentSecret(secret)}`);
    if (!databaseUrl) throw new Error("Question store is unavailable.");
    const accounts = await resolveAccounts(secret.trim());
    await resetProject(databaseUrl);
    markStep(report, "reset-project", "passed");
    console.log("project_reset=bolt-walkthrough");

    browser = await launchChromium();
    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      recordVideo: { dir, size: { width: 1280, height: 800 } },
    };
    projectManagerContext = await browser.newContext(contextOptions);
    developerContext = await browser.newContext(contextOptions);
    projectManagerPage = await projectManagerContext.newPage();
    developerPage = await developerContext.newPage();
    for (const page of [projectManagerPage, developerPage]) {
      page.setDefaultTimeout(UI_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(60_000);
    }

    const origin = String(env.WALKTHROUGH_ORIGIN ?? WALKTHROUGH_ORIGIN);
    const projectManagerToken = await mintSignInToken(
      secret.trim(),
      signInTokenBody({
        userId: accounts.projectManagerId,
        orgId: accounts.organizationId,
      }),
    );
    const developerToken = await mintSignInToken(
      secret.trim(),
      signInTokenBody({
        userId: accounts.developerId,
        orgId: accounts.organizationId,
      }),
    );
    await openSignedIn(
      projectManagerPage,
      origin,
      projectManagerToken,
      WALKTHROUGH_EXPECTATIONS.projectManager,
    );
    markStep(report, "sign-in-project-manager", "passed");
    await openSignedIn(
      developerPage,
      origin,
      developerToken,
      WALKTHROUGH_EXPECTATIONS.developer,
    );
    markStep(report, "sign-in-developer", "passed");

    await projectManagerContext.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    await developerContext.tracing.start({
      screenshots: true,
      snapshots: true,
    });
    tracing = true;

    await walk(
      report,
      { projectManager: projectManagerPage, developer: developerPage },
      dir,
    );
    preview = classifyPreview(await readPreview(projectManagerPage));
    await shoot(projectManagerPage, dir, "preview-project-manager.png");
  } catch (error) {
    if (report.functional !== "failed") {
      const current = report.steps.find((item) => item.status === "not_run");
      if (current) markStep(report, current.name, "failed");
      else report.functional = "failed";
    }
    report.error = redactVerificationError(error?.message || error);
    console.log(report.error);
    if (projectManagerPage) {
      await shoot(projectManagerPage, dir, "failure-project-manager.png");
    }
    if (developerPage) await shoot(developerPage, dir, "failure-developer.png");
  } finally {
    if (tracing) {
      await projectManagerContext.tracing
        .stop({ path: join(dir, "project-manager-trace.zip") })
        .catch(() => undefined);
      await developerContext.tracing
        .stop({ path: join(dir, "developer-trace.zip") })
        .catch(() => undefined);
    }
    const projectManagerVideo = projectManagerPage?.video?.() ?? null;
    const developerVideo = developerPage?.video?.() ?? null;
    await projectManagerContext?.close().catch(() => undefined);
    await developerContext?.close().catch(() => undefined);
    if (projectManagerVideo) {
      await projectManagerVideo
        .saveAs(join(dir, "project-manager.webm"))
        .catch(() => undefined);
    }
    if (developerVideo) {
      await developerVideo
        .saveAs(join(dir, "developer.webm"))
        .catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
    finishReport(report, preview);
    writeReport(dir, report, env);
  }
  return report;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runVerification()
    .then((report) => {
      process.exit(report.functional === "passed" ? 0 : 1);
    })
    .catch((error) => {
      console.log(redactVerificationError(error?.message || error));
      process.exit(1);
    });
}
