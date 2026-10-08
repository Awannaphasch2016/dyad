import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDevelopmentClerk,
  clerkReferencePlan,
  membershipRoleSummary,
  neonSqlHost,
  redact,
} from "./forma-clerk-config.mjs";

test("missing Forma sign-in names reference dyad preview", () => {
  assert.deepEqual(clerkReferencePlan(["OPENROUTER_API_KEY"]), {
    CLERK_PUBLISHABLE_KEY: "${dyad.preview.CLERK_PUBLISHABLE_KEY}",
    CLERK_SECRET_KEY: "${dyad.preview.CLERK_SECRET_KEY}",
    WEWEBPLUS_DATABASE_URL: "${dyad.preview.WEWEBPLUS_DATABASE_URL}",
  });
  assert.deepEqual(
    clerkReferencePlan([
      "CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
      "WEWEBPLUS_DATABASE_URL",
    ]),
    {},
  );
});

test("a live Clerk key stops before any session is opened", () => {
  assert.throws(
    () => assertDevelopmentClerk("live", "test"),
    /Refusing a live Clerk key/,
  );
  assert.doesNotThrow(() => assertDevelopmentClerk("test", "test"));
});

test("the membership query uses the direct Neon host", () => {
  assert.equal(
    neonSqlHost(
      "postgresql://owner:secret@ep-example-pooler.c-4.us-east-1.aws.neon.tech/neondb",
    ),
    "ep-example.c-4.us-east-1.aws.neon.tech",
  );
});

test("membership logs count roles and secret text is redacted", () => {
  assert.equal(
    membershipRoleSummary([
      { role_id: "developer", n: 1 },
      { role_id: "project-manager", n: 1 },
      { role_id: "admin", n: 4 },
    ]),
    "developer:1,project-manager:1",
  );
  assert.equal(
    redact("pk_test_abc sk_live_def postgresql://user:secret@host/db"),
    "clerk_redacted clerk_redacted postgres://redacted",
  );
});
