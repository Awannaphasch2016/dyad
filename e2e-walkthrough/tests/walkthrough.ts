import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

export type RoleKey = "pm" | "dev";

export interface Role {
  key: RoleKey;
  email: string;
  roleId: "project-manager" | "developer";
  label: string;
}

// The two dedicated `+clerk_test` accounts. Emails arrive from the account
// step of the workflow; they are not secrets.
export const ROLES: Record<RoleKey, Role> = {
  pm: {
    key: "pm",
    email: process.env.WALKTHROUGH_PM_EMAIL ?? "",
    roleId: "project-manager",
    label: "Project Manager",
  },
  dev: {
    key: "dev",
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
