import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRegisteredHandlerForTesting } from "./base";
import {
  clerkPublishableKeyFromEnv,
  registerClerkHandlers,
} from "./clerk_handlers";

describe("clerkPublishableKeyFromEnv", () => {
  it("returns only publishable keys", () => {
    expect(clerkPublishableKeyFromEnv(undefined)).toBeNull();
    expect(clerkPublishableKeyFromEnv("  ")).toBeNull();
    expect(clerkPublishableKeyFromEnv("sk_test_secret")).toBeNull();
    expect(clerkPublishableKeyFromEnv(" pk_test_example ")).toBe(
      "pk_test_example",
    );
    expect(clerkPublishableKeyFromEnv("pk_live_example")).toBe(
      "pk_live_example",
    );
  });
});

describe("clerk:get-publishable-key", () => {
  let previous: string | undefined;

  beforeEach(() => {
    registerClerkHandlers();
    previous = process.env.CLERK_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.CLERK_PUBLISHABLE_KEY;
    } else {
      process.env.CLERK_PUBLISHABLE_KEY = previous;
    }
  });

  async function invoke(): Promise<{ publishableKey: string | null }> {
    const handler = getRegisteredHandlerForTesting("clerk:get-publishable-key");
    return (await handler({} as never, undefined)) as {
      publishableKey: string | null;
    };
  }

  it("returns the publishable key from the environment", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    expect(await invoke()).toEqual({ publishableKey: "pk_test_example" });
  });

  it("returns null when the key is missing or is a secret", async () => {
    delete process.env.CLERK_PUBLISHABLE_KEY;
    expect(await invoke()).toEqual({ publishableKey: null });

    process.env.CLERK_PUBLISHABLE_KEY = "sk_test_not_publishable";
    expect(await invoke()).toEqual({ publishableKey: null });
  });
});
