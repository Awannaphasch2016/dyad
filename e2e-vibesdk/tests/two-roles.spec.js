import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

const PM_QUESTION = "What should the page be called?";
const DEV_QUESTION = "Which file should hold the page title?";

async function loadClerk(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const keyResponse = await fetch("/api/auth/clerk", { credentials: "include" });
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
        script.onload = () => resolve();
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
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? "" });
  const token = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 300,
  });
  await clerk.signIn({
    page,
    signInParams: { strategy: "ticket", ticket: token.token },
  });
  await page.reload();
}

async function answerStatus(page, questionId, answer) {
  return page.evaluate(
    async ({ questionId, answer }) => {
      const csrf = await fetch("/api/auth/csrf-token", { credentials: "include" });
      const csrfPayload = csrf.ok ? await csrf.json() : null;
      const token = csrfPayload?.data?.token;
      const response = await fetch(`/api/hitl/questions/${questionId}/answers`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(typeof token === "string" ? { "X-CSRF-Token": token } : {}),
        },
        body: JSON.stringify({ answer }),
      });
      return response.status;
    },
    { questionId, answer },
  );
}

async function openQuestionId(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/hitl", { credentials: "include" });
    const payload = await response.json();
    return payload?.data?.open?.id ?? "";
  });
}

test("the scripted run asks each role and then finishes", async ({ browser }) => {
  test.skip(!process.env.VIBESDK_URL, "VIBESDK_URL is required");
  const pmContext = await browser.newContext({ recordVideo: { dir: "videos/project-manager", size: { width: 1280, height: 720 } } });
  const devContext = await browser.newContext({ recordVideo: { dir: "videos/developer", size: { width: 1280, height: 720 } } });
  const pm = await pmContext.newPage();
  const dev = await devContext.newPage();

  await signIn(pm, process.env.VIBESDK_PM_USER_ID ?? "");
  await signIn(dev, process.env.VIBESDK_DEV_USER_ID ?? "");
  await expect(pm.getByText("You are the Project Manager.")).toBeVisible();
  await expect(dev.getByText("You are the Developer.")).toBeVisible();

  await pm.getByRole("button", { name: "Start the scripted build" }).click();
  await expect(pm.getByText(PM_QUESTION)).toBeVisible();
  await expect(dev.getByText(PM_QUESTION)).toHaveCount(0);
  await expect(dev.getByText("Waiting on the Project Manager.")).toBeVisible();

  const pmQuestionId = await openQuestionId(dev);
  expect(await answerStatus(dev, pmQuestionId, "should be refused")).toBe(403);
  await expect(dev.getByText(PM_QUESTION)).toHaveCount(0);

  await pm.getByLabel("Your answer").fill("North Pier Fish");
  await pm.getByRole("button", { name: "Submit answer" }).click();
  await expect(pm.getByText("The agent continued.")).toBeVisible();
  await expect(pm.getByText("Question: What should the page be called?")).toBeVisible();
  await expect(pm.getByText("Answer: North Pier Fish")).toBeVisible();
  await expect(dev.getByText(PM_QUESTION)).toHaveCount(0);
  await expect(dev.getByText("North Pier Fish")).toHaveCount(0);
  await expect(dev.getByText(DEV_QUESTION)).toBeVisible();
  await expect(pm.getByText(DEV_QUESTION)).toHaveCount(0);
  await expect(pm.getByText("Waiting on the Developer.")).toBeVisible();

  const devQuestionId = await openQuestionId(pm);
  expect(await answerStatus(pm, devQuestionId, "should be refused")).toBe(403);

  await dev.getByLabel("Your answer").fill("index.html");
  await dev.getByRole("button", { name: "Submit answer" }).click();
  await expect(pm.getByText("The app is complete.")).toBeVisible();
  await expect(dev.getByText("The app is complete.")).toBeVisible();
  await expect(pm.getByText(DEV_QUESTION)).toHaveCount(0);
  await expect(dev.getByText(PM_QUESTION)).toHaveCount(0);
  await expect(pm.getByLabel("Your answer")).toHaveCount(0);
  await expect(dev.getByLabel("Your answer")).toHaveCount(0);
  await expect(dev.getByText("Question: Which file should hold the page title?")).toBeVisible();
  await expect(dev.getByText("Answer: index.html")).toBeVisible();

  await pmContext.close();
  await devContext.close();
});
