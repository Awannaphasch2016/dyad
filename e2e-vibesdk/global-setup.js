import { clerkSetup } from "@clerk/testing/playwright";
import { mkdirSync } from "node:fs";

// Mints one Clerk Testing Token so headless Chromium is not treated as a bot.
// Reads the Development instance keys from the job environment and prints neither.
export default async function globalSetup() {
  mkdirSync("artifacts", { recursive: true });
  const publishable = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  if (!publishable.startsWith("pk_test_") || !secret.startsWith("sk_test_")) {
    throw new Error(
      "The organization check runs against a Development Clerk instance only",
    );
  }
  await clerkSetup({ dotenv: false });
  console.log(
    `clerk_fapi=${process.env.CLERK_FAPI ? "present" : "absent"} testing_token=${process.env.CLERK_TESTING_TOKEN ? "present" : "absent"}`,
  );
}
