import assert from "node:assert/strict";
import test from "node:test";
import { clerkPublishableKey } from "./clerk_env.ts";

test("reads CLERK_PUBLISHABLE_KEY", () => {
  const previous = process.env.CLERK_PUBLISHABLE_KEY;
  const previousPublic = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_from_doppler";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_ignored";
  try {
    assert.equal(clerkPublishableKey(), "pk_test_from_doppler");
  } finally {
    restore("CLERK_PUBLISHABLE_KEY", previous);
    restore("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", previousPublic);
  }
});

test("treats a blank CLERK_PUBLISHABLE_KEY as unset", () => {
  const previous = process.env.CLERK_PUBLISHABLE_KEY;
  process.env.CLERK_PUBLISHABLE_KEY = "  ";
  try {
    assert.equal(clerkPublishableKey(), undefined);
  } finally {
    restore("CLERK_PUBLISHABLE_KEY", previous);
  }
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
