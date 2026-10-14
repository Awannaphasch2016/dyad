import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const PROMPT = "Build a website for a neighborhood shop.";

async function loadClerk(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const keyResponse = await fetch("/api/auth/clerk", {
      credentials: "include",
    });
    if (!keyResponse.ok) throw new Error("clerk key missing");
    const key = (await keyResponse.json()).data.publishableKey;
    const frontendApi = atob(key.slice("pk_test_".length)).replace(/\$$/, "");
    if (!window.Clerk) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.async = true;
        script.crossOrigin = "anonymous";
        script.src = `https://${frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
        script.setAttribute("data-clerk-publishable-key", key);
        script.onload = () => resolve(undefined);
        script.onerror = () => reject(new Error("clerk script failed"));
        document.head.appendChild(script);
      });
    }
    await window.Clerk.load({ publishableKey: key });
  });
  await clerk.loaded({ page });
}

async function signIn(page, userId) {
  await setupClerkTestingToken({ context: page.context() });
  await loadClerk(page);
  const client = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? "",
  });
  const token = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 300,
  });
  await clerk.signIn({
    page,
    signInParams: { strategy: "ticket", ticket: token.token },
  });
  await page.waitForFunction(() => window.Clerk?.user != null);
  await page.reload();
}

async function answerQuestion(question) {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key)
    throw new Error(
      "OPENROUTER_API_KEY is required to answer the live question",
    );
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: /build|implement|accept|publish|approve/i.test(question)
              ? "The builder is asking whether to continue this app. Reply with one short approval. No preamble."
              : "You are answering one question from a web builder. Reply with one short sentence the builder can use. No preamble.",
          },
          { role: "user", content: question },
        ],
      }),
    },
  );
  if (!response.ok) throw new Error(`answer model status ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("answer model returned nothing");
  return text.trim().slice(0, 400);
}

async function clerkName(userId) {
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  if (!secret || !userId) return "";
  const response = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  if (!response.ok) return "";
  const user = await response.json();
  const name = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    name || (typeof user.username === "string" ? user.username.trim() : "")
  );
}

async function questionText(page) {
  const locator = page.getByTestId("org-question");
  if ((await locator.count()) === 0) return "";
  if (!(await locator.first().isVisible())) return "";
  return (await locator.first().innerText()).trim();
}

async function shot(page, name) {
  await page.screenshot({ path: `artifacts/${name}.png` });
}

test("the project manager starts the organization app and each role answers the live question", async ({
  browser,
}) => {
  test.skip(!process.env.VIBESDK_URL, "VIBESDK_URL is required");
  test.setTimeout(25 * 60 * 1000);
  mkdirSync("artifacts", { recursive: true });
  const pmContext = await browser.newContext({
    recordVideo: {
      dir: "videos/project-manager",
      size: { width: 1280, height: 720 },
    },
  });
  const devContext = await browser.newContext({
    recordVideo: {
      dir: "videos/developer",
      size: { width: 1280, height: 720 },
    },
  });
  const pm = await pmContext.newPage();
  const dev = await devContext.newPage();
  const answered = new Set();
  let firstQuestion = "";

  try {
    await signIn(pm, process.env.VIBESDK_PM_USER_ID ?? "");
    await signIn(dev, process.env.VIBESDK_DEV_USER_ID ?? "");
    await expect(pm.getByText("Project Manager").first()).toBeVisible();
    await expect(dev.getByText("Developer").first()).toBeVisible();

    const devBox = dev.locator("textarea").first();
    await devBox.fill("Build a private app");
    await devBox.press("Enter");
    await dev.waitForTimeout(1500);
    await expect(dev).not.toHaveURL(/\/chat\//);
    await shot(dev, "developer-enter-does-not-start");

    const pmBox = pm.locator("textarea").first();
    await pmBox.fill(PROMPT);
    await pmBox.press("Enter");
    await pm.waitForURL(/\/chat\/(?!new)/, { timeout: 90_000 });
    const appUrl = new URL(pm.url());
    await shot(pm, "project-manager-started");

    const appLink = dev.locator(`a[href="${appUrl.pathname}"]`);
    await expect(appLink.first()).toBeVisible({ timeout: 45_000 });
    await expect(
      pm.getByText("Wewebplus", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      dev.getByText("Wewebplus", { exact: true }).first(),
    ).toBeVisible();
    await appLink.first().click();
    await expect(pm.getByRole("button", { name: "Make public" })).toHaveCount(
      0,
    );
    await expect(dev.getByRole("button", { name: "Make public" })).toHaveCount(
      0,
    );
    await dev.waitForURL(
      new RegExp(appUrl.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    await shot(dev, "developer-opened-app");
    const pmName = await clerkName(process.env.VIBESDK_PM_USER_ID ?? "");
    const devName = await clerkName(process.env.VIBESDK_DEV_USER_ID ?? "");
    expect(pmName).toBeTruthy();
    await expect(pm.getByTestId("org-turn").first()).toHaveText(pmName, {
      timeout: 30_000,
    });
    await expect(dev.getByTestId("org-turn").first()).toHaveText(pmName, {
      timeout: 30_000,
    });
    await expect(
      pm.getByTestId("org-human-turn").first().getByTestId("org-avatar-pm"),
    ).toBeVisible();
    await expect(
      dev.getByTestId("org-human-turn").first().getByTestId("org-avatar-pm"),
    ).toBeVisible();
    await shot(pm, "project-manager-named-turn");
    await shot(dev, "developer-sees-named-turn");

    await expect(pm.getByText("spec.md").first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(dev.getByText("spec.md").first()).toBeVisible({
      timeout: 30_000,
    });
    await shot(pm, "spec-kit-first-step");
    await shot(dev, "developer-sees-spec");

    const deadline = Date.now() + 18 * 60 * 1000;
    const previewFrame = (page) => page.locator('iframe[title="App Preview"]');
    while (Date.now() < deadline) {
      if (
        (await previewFrame(pm).count()) > 0 &&
        (await previewFrame(dev).count()) > 0
      ) {
        break;
      }
      for (const page of [pm, dev]) {
        const previewButton = page.getByTitle("Preview");
        if ((await previewButton.count()) > 0)
          await previewButton.first().click();
      }
      const pmQuestion = await questionText(pm);
      const devQuestion = await questionText(dev);
      if (pmQuestion && devQuestion) {
        throw new Error("both roles can see a question at the same time");
      }
      const speaker = pmQuestion ? pm : devQuestion ? dev : null;
      const listener = speaker === pm ? dev : speaker === dev ? pm : null;
      const asked = pmQuestion || devQuestion;
      if (!speaker || !listener || !asked || answered.has(asked)) {
        await pm.waitForTimeout(3000);
        continue;
      }
      if (!firstQuestion) firstQuestion = asked;
      const speakerName = speaker === pm ? pmName : devName;
      const avatar = speaker === pm ? "org-avatar-pm" : "org-avatar-dev";
      await expect(listener.getByText(asked, { exact: false })).toHaveCount(0);
      await expect(listener.getByTestId("org-question")).toHaveCount(0);
      await expect(listener.getByTestId("org-builder-question")).toHaveCount(0);
      await expect(listener.getByTestId("org-pending")).toBeVisible();
      await expect(
        listener.getByTestId("org-pending").getByTestId("org-turn"),
      ).toHaveText(speakerName);
      await expect(
        listener.getByTestId("org-pending").getByTestId(avatar),
      ).toBeVisible();
      await expect(listener.getByTestId("org-response-required")).toBeVisible();
      await expect(speaker.getByTestId("org-builder-question")).toContainText(
        "Orange",
      );
      await expect(speaker.getByTestId("org-question")).toHaveText(asked);
      await expect(speaker.getByTestId("org-pending")).toBeVisible();
      await expect(
        speaker.getByTestId("org-pending").getByTestId(avatar),
      ).toBeVisible();
      await expect(
        speaker.getByText("Waiting on the Project Manager.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        listener.getByText("Waiting on the Project Manager.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        speaker.getByText("Waiting on the Developer.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        listener.getByText("Waiting on the Developer.", { exact: true }),
      ).toHaveCount(0);
      await expect(listener.locator("textarea").last()).toBeDisabled();
      await expect(listener.getByText("Reply in the prompt box.")).toHaveCount(
        0,
      );
      await shot(speaker, `question-${answered.size + 1}`);
      await shot(listener, `waiting-${answered.size + 1}`);
      const reply = await answerQuestion(asked);
      const box = speaker.locator("textarea").last();
      await expect(box).toBeEnabled();
      await box.fill(reply);
      await box.press("Enter");
      answered.add(asked);
      const preview = reply.slice(0, 48);
      const heard = listener
        .getByTestId("org-human-turn")
        .filter({ hasText: preview });
      await expect(heard.first()).toBeVisible({ timeout: 20_000 });
      await expect(heard.first().getByTestId("org-turn")).toHaveText(
        speakerName,
      );
      await expect(heard.first().getByTestId(avatar)).toBeVisible();
      await expect(listener.getByTestId("org-pending")).toHaveCount(0);
      await expect(speaker.getByTestId("org-pending")).toHaveCount(0);
      await expect(
        speaker.getByText("Waiting on the Project Manager.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        listener.getByText("Waiting on the Project Manager.", { exact: true }),
      ).toHaveCount(0);
      await shot(speaker, `answered-${answered.size}`);
      await shot(listener, `heard-${answered.size}`);
    }

    expect(answered.size).toBeGreaterThan(0);
    expect(firstQuestion).toBeTruthy();
    await expect(previewFrame(pm)).toBeVisible();
    await expect(previewFrame(dev)).toBeVisible();
    expect(new URL(pm.url()).pathname).toBe(appUrl.pathname);
    expect(new URL(dev.url()).pathname).toBe(appUrl.pathname);
    for (const page of [pm, dev]) {
      await expect(page.getByText("Wrote /spec.md")).toHaveCount(0);
      await expect(page.getByText("Seems we lost connection")).toHaveCount(0);
      await expect(page.getByText("Continue the current step")).toHaveCount(0);
      await expect(
        page.getByText("Build a short hours page for the shop."),
      ).toHaveCount(0);
    }
    await shot(pm, "shop-preview-project-manager");
    await shot(dev, "shop-preview-developer");
  } finally {
    await pmContext.close();
    await devContext.close();
  }
});
