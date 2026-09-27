import { afterEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { setSessionVerifierForTesting } from "@/control_plane/access";
import {
  clearSessionTokensForTesting,
  rememberSessionToken,
} from "@/control_plane/session_store";
import { getRegisteredHandlerForTesting } from "./base";
import { registerClerkHandlers } from "./clerk_handlers";

const event = { sender: { id: 7 } } as never;

describe("organization member changes", () => {
  const previousPublishable = process.env.CLERK_PUBLISHABLE_KEY;
  const previousSecret = process.env.CLERK_SECRET_KEY;

  afterEach(() => {
    setSessionVerifierForTesting(null);
    clearSessionTokensForTesting();
    vi.unstubAllGlobals();
    if (previousPublishable === undefined) {
      delete process.env.CLERK_PUBLISHABLE_KEY;
    } else process.env.CLERK_PUBLISHABLE_KEY = previousPublishable;
    if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousSecret;
  });

  it("refuses an invite when the membership role cannot manage members", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    rememberSessionToken(7, "session-token");
    setSessionVerifierForTesting(async () => ({
      userId: "user_dev",
      orgId: "org_1",
      roleId: "dev",
      displayName: "Dev",
      member: true,
    }));
    registerClerkHandlers();
    const handler = getRegisteredHandlerForTesting("clerk:invite-member");
    await expect(
      handler(event, { email: "new@example.com", roleId: "reviewer" }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
    });
  });
});
