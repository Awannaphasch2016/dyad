import { createClerkClient } from "@clerk/backend";
import type { BrowserContext, Page } from "@playwright/test";

/** Same ids as src/control_plane/hitl.ts. The workflow test checks they match. */
export const WEWEBPLUS_ORG_ID = "org_3JuOz4PCITqmueMeKYhcFUXAEIH";
export const PROJECT_MANAGER_USER_ID = "user_3Jo9AXjywP5QJtRbqTWJTn5sdxN";
export const DEVELOPER_USER_ID = "user_3K58joknYZ90Fts4yQC6yq4Enay";

const TESTING_TOKEN_PARAM = "__clerk_testing_token";

interface ClerkMembership {
  role?: string;
  organization: { id: string };
  publicMetadata?: { role?: unknown };
}

interface ClerkLike {
  loaded?: boolean;
  user?: { organizationMemberships?: ClerkMembership[] } | null;
  organization?: { id: string } | null;
  client?: {
    signIn: {
      create: (params: {
        strategy: "ticket";
        ticket: string;
      }) => Promise<{ status: string; createdSessionId: string | null }>;
    };
  };
  setActive: (params: {
    session: string | null;
    organization: string;
  }) => Promise<unknown>;
}

declare global {
  interface Window {
    Clerk?: ClerkLike;
  }
}

function clerkFrontendHost(publishableKey: string): string | null {
  const prefix = publishableKey.startsWith("pk_test_")
    ? "pk_test_"
    : publishableKey.startsWith("pk_live_")
      ? "pk_live_"
      : null;
  if (!prefix) return null;
  try {
    const encoded = publishableKey.slice(prefix.length);
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const host = decoded.replace(/\$$/, "").trim();
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Clerk's ticket sign-in, the same call the Bolt walkthrough uses.
 * The testing token bypasses bot protection on the Frontend API.
 * The ticket is created here and consumed in this page. It is not logged.
 */
export async function installClerkTestingToken(
  context: BrowserContext,
): Promise<void> {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() ?? "";
  const frontendApi = clerkFrontendHost(publishableKey);
  if (!frontendApi) {
    throw new Error("CLERK_PUBLISHABLE_KEY is not a publishable key.");
  }
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required.");
  if (!process.env.CLERK_TESTING_TOKEN) {
    const client = createClerkClient({ secretKey });
    const testing = await client.testingTokens.createTestingToken();
    process.env.CLERK_TESTING_TOKEN = testing.token;
  }
  const escaped = frontendApi.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const apiUrl = new RegExp(`^https://${escaped}/v1/`);
  await context.route(apiUrl, async (route) => {
    const url = new URL(route.request().url());
    const token = process.env.CLERK_TESTING_TOKEN;
    if (token) url.searchParams.set(TESTING_TOKEN_PARAM, token);
    const response = await route.fetch({ url: url.toString() });
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("json")) {
      await route.fulfill({ response });
      return;
    }
    const json = await response.json();
    if (json?.response?.captcha_bypass === false) {
      json.response.captcha_bypass = true;
    }
    if (json?.client?.captcha_bypass === false) {
      json.client.captcha_bypass = true;
    }
    await route.fulfill({ response, json });
  });
}

export async function signInAs(
  page: Page,
  userId: string,
  orgId: string,
): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() ?? "";
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required.");
  const client = createClerkClient({ secretKey });
  const created = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds: 300,
  });
  await page.waitForFunction(() => window.Clerk?.loaded === true);
  await page.evaluate(
    async ({ ticket, organizationId }) => {
      const clerk = window.Clerk;
      if (!clerk?.client) throw new Error("Clerk did not start.");
      const attempt = await clerk.client.signIn.create({
        strategy: "ticket",
        ticket,
      });
      if (attempt.status !== "complete" || !attempt.createdSessionId) {
        throw new Error(
          `Sign-in with ticket failed. Status: ${attempt.status}`,
        );
      }
      await clerk.setActive({
        session: attempt.createdSessionId,
        organization: organizationId,
      });
    },
    { ticket: created.token, organizationId: orgId },
  );
  await page.waitForFunction(
    (id) => window.Clerk?.user != null && window.Clerk.organization?.id === id,
    orgId,
  );
}

export async function membershipRole(
  page: Page,
  orgId: string,
): Promise<string | null> {
  return page.evaluate((id) => {
    const membership = window.Clerk?.user?.organizationMemberships?.find(
      (item) => item.organization.id === id,
    );
    const role = membership?.publicMetadata?.role;
    return typeof role === "string" ? role : null;
  }, orgId);
}
