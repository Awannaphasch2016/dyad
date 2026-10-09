import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { writeFileSync } from "node:fs";

export type RoleKey = "pm" | "dev";

export interface Role {
  key: RoleKey;
  userId: string;
  // "email" when Clerk holds an address for the user, "none" when the
  // instance refused one. A sign-in token needs an identification.
  identifier: string;
  email: string;
  roleId: "project-manager" | "developer";
  label: string;
}

// The two dedicated `+clerk_test` accounts. Emails arrive from the account
// step of the workflow; they are not secrets.
export const ROLES: Record<RoleKey, Role> = {
  pm: {
    key: "pm",
    userId: process.env.WALKTHROUGH_PM_USER_ID ?? "",
    identifier: process.env.WALKTHROUGH_PM_IDENTIFIER ?? "none",
    email: process.env.WALKTHROUGH_PM_EMAIL ?? "",
    roleId: "project-manager",
    label: "Project Manager",
  },
  dev: {
    key: "dev",
    userId: process.env.WALKTHROUGH_DEV_USER_ID ?? "",
    identifier: process.env.WALKTHROUGH_DEV_IDENTIFIER ?? "none",
    email: process.env.WALKTHROUGH_DEV_EMAIL ?? "",
    roleId: "developer",
    label: "Developer",
  },
};

export interface ProjectProbe {
  status: number;
  body: Record<string, unknown> | null;
}

// `window.Clerk` is typed by @clerk/testing's global declaration.

// Register the Testing Token route before Clerk JS loads, then open the page
// and wait for Clerk.
export async function openWalkthrough(context: BrowserContext, page: Page) {
  await setupClerkTestingToken({ context });
  await page.goto("/");
  await clerk.loaded({ page });
}

// Sign in by user id: a one-time sign-in token from the Backend API, consumed
// in the page with the ticket strategy. Works whether or not the user has an
// email address, and skips every verification step by design.
export const NO_IDENTIFICATION =
  "The given token doesn't have an associated identification";

export async function signInAs(page: Page, userId: string) {
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
}

// The same request the page makes every two seconds. 401 when signed out.
export async function projectSnapshot(page: Page): Promise<ProjectProbe> {
  return page.evaluate(async () => {
    const token = await window.Clerk?.session?.getToken();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const response = await fetch("/api/project", { headers });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  });
}

export function writeReport(name: string, data: Record<string, unknown>) {
  writeFileSync(`report/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

export async function composerCovered(box: Locator): Promise<boolean> {
  return box.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + Math.min(24, Math.max(rect.width / 2, 1)),
      rect.top + Math.min(24, Math.max(rect.height / 2, 1)),
    );
    return hit !== element && !element.contains(hit);
  });
}

// Discovery keeps the approval card open over the whole page, so the
// composer can be covered. A real keystroke is used when it is not. When it
// is, the same React handlers run from a DOM event and the report says so.
export async function pressComposerEnter(page: Page, prompt: string) {
  const box = page.getByPlaceholder("Describe the page");
  await expect(box).toBeVisible();
  const covered = await composerCovered(box);
  if (!covered) {
    await box.fill(prompt);
    await box.press("Enter");
    return { covered };
  }
  await box.evaluate((element, text) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, prompt);
  await expect(
    box.locator("xpath=parent::div//button[contains(@class,'absolute')]"),
  ).toBeAttached();
  await box.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return { covered };
}

export const sendWalkthroughPrompt = pressComposerEnter;

// The live preview keeps Move to Implementation off while the latest assistant
// reply still asks a question. These are the fixed answers for that case.
export const DISCOVERY_FOLLOW_UPS = [
  "Yes. The page name is North Pier Fish.",
  "Welcome to North Pier Fish.",
  "The page shows the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.",
];

export function assistantAsksQuestion(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").includes("?");
}

export function newAssistantMessages(
  messages: { id: string; role: string; content: string }[] | undefined,
  knownIds: ReadonlySet<string>,
) {
  return (messages ?? []).filter(
    (message) =>
      message.role === "assistant" &&
      message.content.trim() &&
      !knownIds.has(message.id),
  );
}

export function replyProof(content: string, filePath: string) {
  const plain = content
    .replace(/<boltAction[\s\S]*?<\/boltAction>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length >= 20) return plain.slice(0, 60);
  return filePath.split("/").pop() || filePath;
}

export function latestAssistant(
  messages: { id: string; role: string; content: string }[] | undefined,
) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages?.[index];
    if (message && message.role === "assistant" && message.content.trim()) {
      return message;
    }
  }
  return null;
}

// Send the fixed answers while Discovery's latest reply asks a question and
// the transition is still closed. Stop when the server opens the transition.
export async function finishDiscovery(page: Page) {
  let followUps = 0;
  const deadline = Date.now() + 12 * 60 * 1000;
  let previousAssistantId = "";
  while (Date.now() < deadline) {
    const probe = await projectSnapshot(page);
    const body = (probe.body ?? {}) as {
      canTransition?: boolean;
      messages?: { id: string; role: string; content: string }[];
    };
    if (probe.status === 200 && body.canTransition === true) {
      return { messages: body.messages ?? [], followUps };
    }
    const latest = latestAssistant(body.messages);
    if (
      probe.status === 200 &&
      latest &&
      latest.id !== previousAssistantId &&
      assistantAsksQuestion(latest.content)
    ) {
      if (followUps >= DISCOVERY_FOLLOW_UPS.length) {
        throw new Error(
          `Discovery still has a question after the fixed answers: ${latest.content.slice(0, 180)}`,
        );
      }
      previousAssistantId = latest.id;
      await sendWalkthroughPrompt(page, DISCOVERY_FOLLOW_UPS[followUps]);
      followUps += 1;
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error("Move to Implementation did not open");
}
