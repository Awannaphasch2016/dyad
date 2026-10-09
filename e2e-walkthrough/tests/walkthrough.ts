import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

export type RoleKey = "pm" | "dev";

export interface Role {
  key: RoleKey;
  userId: string;
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
    email: process.env.WALKTHROUGH_PM_EMAIL ?? "",
    roleId: "project-manager",
    label: "Project Manager",
  },
  dev: {
    key: "dev",
    userId: process.env.WALKTHROUGH_DEV_USER_ID ?? "",
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
