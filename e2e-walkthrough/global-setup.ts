import { clerkSetup } from "@clerk/testing/playwright";
import { mkdirSync } from "node:fs";

// Mints one Clerk Testing Token (Development instance only) so Turnstile does
// not treat headless Chromium as a bot. Reads CLERK_PUBLISHABLE_KEY and
// CLERK_SECRET_KEY from the job environment; prints neither.
export default async function globalSetup() {
  mkdirSync("report", { recursive: true });
  mkdirSync("artifacts", { recursive: true });
  const publishable = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  if (!publishable.startsWith("pk_test_") || !secret.startsWith("sk_test_")) {
    throw new Error(
      "Walkthrough checks run against a Development Clerk instance only",
    );
  }
  await clerkSetup({ dotenv: false });
  console.log(
    `clerk_fapi=${process.env.CLERK_FAPI ?? "absent"} testing_token=${process.env.CLERK_TESTING_TOKEN ? "present" : "absent"}`,
  );
}
