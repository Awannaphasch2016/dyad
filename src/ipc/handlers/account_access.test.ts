import { afterEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  resolveAccountSession,
  setSessionVerifierForTesting,
} from "@/control_plane/access";
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
      roleId: "developer",
      canInvite: false,
      displayName: "Dev",
      member: true,
    }));
    registerClerkHandlers();
    const handler = getRegisteredHandlerForTesting("clerk:invite-member");
    await expect(
      handler(event, { email: "new@example.com", roleId: "developer" }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
    });
  });

  it("keeps the iPad session after the Electron window signs out", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    registerClerkHandlers();
    const setToken = getRegisteredHandlerForTesting("clerk:set-session-token");
    await setToken(event, { token: "ipad-token", bridge: true });
    await setToken(event, { token: null });
    setSessionVerifierForTesting(async (token) => {
      expect(token).toBe("ipad-token");
      return {
        userId: "user_owner",
        orgId: null,
        roleId: null,
        canInvite: false,
        displayName: "Anak",
        member: true,
      };
    });
    await expect(resolveAccountSession(event)).resolves.toMatchObject({
      mode: "signed-in",
      userId: "user_owner",
    });
  });

  it("prefers the Electron window token when that window is signed in", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    registerClerkHandlers();
    const setToken = getRegisteredHandlerForTesting("clerk:set-session-token");
    await setToken(event, { token: "ipad-token", bridge: true });
    await setToken(event, { token: "electron-token" });
    setSessionVerifierForTesting(async (token) => {
      expect(token).toBe("electron-token");
      return {
        userId: "user_desktop",
        orgId: null,
        roleId: null,
        canInvite: false,
        displayName: "Desktop",
        member: true,
      };
    });
    await expect(resolveAccountSession(event)).resolves.toMatchObject({
      userId: "user_desktop",
    });
  });

  it("stamps the organization creator as owner and admin", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    rememberSessionToken(7, "session-token");
    setSessionVerifierForTesting(async () => ({
      userId: "user_owner",
      orgId: null,
      roleId: null,
      canInvite: true,
      displayName: "Anak",
      member: true,
    }));
    const calls: Array<{
      url: string;
      method: string;
      body: string | undefined;
    }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body as string,
      });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(
          JSON.stringify({
            data: [
              {
                role: "org:admin",
                public_user_data: { user_id: "user_owner" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    registerClerkHandlers();
    const handler = getRegisteredHandlerForTesting(
      "clerk:stamp-organization-admin",
    );
    await handler(event, { organizationId: "org_created" });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    expect(calls[0]?.url).toContain(
      "/v1/organizations/org_created/memberships?user_id=user_owner",
    );
    expect(calls[1]?.url).toContain(
      "/v1/organizations/org_created/memberships/user_owner",
    );
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      role: "org:admin",
    });
  });

  it("does not let an invited member stamp themselves admin", async () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    rememberSessionToken(7, "session-token");
    setSessionVerifierForTesting(async () => ({
      userId: "user_member",
      orgId: "org_created",
      roleId: null,
      canInvite: false,
      displayName: "Member",
      member: true,
    }));
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return new Response(
        JSON.stringify({
          data: [
            {
              role: "org:member",
              public_user_data: { user_id: "user_member" },
            },
          ],
        }),
        { status: 200 },
      );
    });
    registerClerkHandlers();
    const handler = getRegisteredHandlerForTesting(
      "clerk:stamp-organization-admin",
    );
    await expect(
      handler(event, { organizationId: "org_created" }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
      message: "Only the person who created the organization is its admin.",
    });
    expect(methods).toEqual(["GET"]);
  });
});
