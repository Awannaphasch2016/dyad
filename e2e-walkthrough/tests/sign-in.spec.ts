import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import {
  NO_IDENTIFICATION,
  ROLES,
  openWalkthrough,
  projectSnapshot,
  signInAs,
  writeReport,
  type RoleKey,
} from "./walkthrough";

// Question under test: can a browser sign in to the walkthrough with no
// person confirming anything? Each role gets its own context, so the two
// sessions never share a cookie jar.

const BLOCKED =
  "Clerk refuses a sign-in token for a user with no identification, and this " +
  "social-only Development instance refuses to give the test users an email " +
  "address through the Backend API. Turning on the Email address attribute in " +
  "the Clerk Dashboard (User & authentication → Email, phone, username) is the " +
  "one remaining step; no password is needed for the token path.";

test("preflight: the instance lets a token sign in the test users", async ({
  page,
  context,
}) => {
  const pm = ROLES.pm;
  test.skip(!pm.userId, "WALKTHROUGH_PM_USER_ID is absent");
  await openWalkthrough(context, page);
  let error: string | null = null;
  try {
    await signInAs(page, pm.userId);
  } catch (caught) {
    error = String((caught as Error).message ?? caught);
  }
  const blocked = error !== null && error.includes(NO_IDENTIFICATION);
  writeReport("token-sign-in-preflight", {
    userId: pm.userId,
    identifier: pm.identifier,
    outcome: error === null ? "signed in" : blocked ? "blocked" : "failed",
    error,
    verdict:
      error === null
        ? "a sign-in token signs the test user in with no human step"
        : blocked
          ? BLOCKED
          : "sign-in failed for another reason; see error",
  });
  await page.screenshot({ path: "artifacts/preflight.png" });
  if (error === null) {
    await clerk.signOut({ page });
    return;
  }
  throw new Error(blocked ? BLOCKED : error);
});

for (const key of ["pm", "dev"] as RoleKey[]) {
  const role = ROLES[key];

  test(`${key}: a sign-in token signs in with no human step`, async ({
    page,
    context,
  }) => {
    test.skip(
      !role.userId,
      `WALKTHROUGH_${key.toUpperCase()}_USER_ID is absent`,
    );
    test.skip(role.identifier === "none", BLOCKED);

    await openWalkthrough(context, page);
    await expect(page.getByTestId("bolt-sign-in")).toBeVisible();
    const signedOut = await projectSnapshot(page);
    expect(signedOut.status).toBe(401);
    await page.screenshot({ path: `artifacts/${key}-1-signed-out.png` });

    const started = Date.now();
    await signInAs(page, role.userId);
    const account = page.getByTestId("bolt-account");
    await expect(account).toBeVisible();
    await expect(account).toContainText(role.label);
    const seconds = Math.round((Date.now() - started) / 100) / 10;

    const signedIn = await projectSnapshot(page);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body?.roleId).toBe(role.roleId);
    await page.screenshot({
      path: `artifacts/${key}-2-signed-in.png`,
      fullPage: true,
    });

    await page.reload();
    await clerk.loaded({ page });
    await expect(page.getByTestId("bolt-account")).toBeVisible();
    const afterReload = await projectSnapshot(page);
    expect(afterReload.status).toBe(200);

    await clerk.signOut({ page });
    await expect(page.getByTestId("bolt-sign-in")).toBeVisible();
    const signedOutAgain = await projectSnapshot(page);
    expect(signedOutAgain.status).toBe(401);
    await page.screenshot({ path: `artifacts/${key}-3-signed-out.png` });

    writeReport(`${key}-sign-in`, {
      role: key,
      userId: role.userId,
      email: role.email,
      strategy: "ticket (Backend API sign-in token, 300 s)",
      humanStep: "none",
      secondsToSignIn: seconds,
      roleId: signedIn.body?.roleId ?? null,
      phase: signedIn.body?.phase ?? null,
      canSend: signedIn.body?.canSend ?? null,
      waitingLabel: signedIn.body?.waitingLabel ?? null,
      reloadKeepsSession: afterReload.status === 200,
      signedOutStatus: signedOutAgain.status,
    });
  });
}

test("password sign-in: what this Development instance allows today", async ({
  page,
  context,
}) => {
  const pm = ROLES.pm;
  test.skip(!pm.userId, "WALKTHROUGH_PM_USER_ID is absent");
  const fapi = process.env.CLERK_FAPI ?? "";
  const environment = (await (
    await fetch(`https://${fapi}/v1/environment`)
  ).json()) as {
    auth_config?: { first_factors?: string[]; test_mode?: boolean };
    user_settings?: {
      attributes?: Record<string, { enabled?: boolean }>;
      sign_in?: { second_factor?: { required?: boolean } };
    };
  };
  const firstFactors = environment.auth_config?.first_factors ?? [];
  const passwordOn =
    firstFactors.includes("password") &&
    environment.user_settings?.attributes?.password?.enabled === true;
  const password = process.env.WALKTHROUGH_TEST_PASSWORD ?? "";

  await openWalkthrough(context, page);
  await expect(page.getByTestId("bolt-sign-in")).toBeVisible();

  const attempt = await page.evaluate(
    async ({ identifier, secret }) => {
      try {
        const result = await window.Clerk!.client!.signIn.create({
          identifier,
          password: secret,
        });
        return {
          status: result.status,
          createdSessionId: result.createdSessionId,
          error: null as string | null,
        };
      } catch (error) {
        const clerkError = error as {
          errors?: Array<{ code?: string; message?: string }>;
          message?: string;
        };
        return {
          status: null,
          createdSessionId: null,
          error:
            clerkError.errors?.[0]?.code ??
            clerkError.errors?.[0]?.message ??
            clerkError.message ??
            String(error),
        };
      }
    },
    { identifier: pm.email, secret: password || "not-configured" },
  );

  let verdict: string;
  if (passwordOn && password) {
    expect(attempt.status).toBe("complete");
    await page.evaluate(
      (session) => window.Clerk!.setActive({ session }),
      attempt.createdSessionId,
    );
    await expect(page.getByTestId("bolt-account")).toBeVisible();
    verdict = "password sign-in completes with no human step";
    await clerk.signOut({ page });
  } else {
    expect(attempt.createdSessionId).toBeNull();
    expect(firstFactors).not.toContain("password");
    verdict = passwordOn
      ? "password is enabled on the instance but WALKTHROUGH_TEST_PASSWORD is absent"
      : "password is not a first factor on this Development instance; only Google, Microsoft, and sign-in tokens are. The Dashboard (User & authentication → Email, phone, username → Password) is the only place it can be turned on; the Backend API has no setting for it.";
  }
  await page.screenshot({ path: "artifacts/password-attempt.png" });

  writeReport("password-strategy", {
    instanceFirstFactors: firstFactors,
    passwordFirstFactor: passwordOn,
    secondFactorRequired:
      environment.user_settings?.sign_in?.second_factor?.required === true,
    testMode: environment.auth_config?.test_mode === true,
    attempt,
    verdict,
  });
});
