import { afterEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  clearSessionTokensForTesting,
  rememberSessionToken,
} from "./session_store";

const verifyToken = vi.hoisted(() => vi.fn());

vi.mock("@clerk/backend", () => ({
  verifyToken,
}));

import {
  decideAccess,
  defaultVerifySessionToken,
  resolveAccountSession,
  roleFromMembership,
} from "./access";
import { privateOwner } from "./owner";

describe("account access", () => {
  it("lets a private owner manage their own account and hides other people's apps", () => {
    const session = {
      mode: "signed-in" as const,
      userId: "user_a",
      account: privateOwner("user_a"),
      roleId: null,
      canInvite: false,
      displayName: "Ada",
    };
    expect(
      decideAccess({
        session,
        permission: "manage-members",
        owner: privateOwner("user_a"),
        organizationOnly: true,
      }).kind,
    ).toBe("precondition");
    expect(
      decideAccess({
        session,
        permission: "approve-discovery",
        owner: privateOwner("user_b"),
      }).kind,
    ).toBe("not-found");
  });

  it("keeps organization roles separate from the private account", () => {
    const reviewer = {
      mode: "signed-in" as const,
      userId: "user_a",
      account: { type: "org" as const, id: "org_1" },
      roleId: "developer" as const,
      canInvite: false,
      displayName: "Ada",
    };
    expect(
      decideAccess({
        session: reviewer,
        permission: "manage-members",
        owner: { type: "org", id: "org_1" },
        organizationOnly: true,
      }).kind,
    ).toBe("forbidden");
    expect(
      decideAccess({
        session: { ...reviewer, canInvite: true },
        permission: "manage-members",
        owner: { type: "org", id: "org_1" },
        organizationOnly: true,
      }).kind,
    ).toBe("allow");
    expect(
      decideAccess({
        session: reviewer,
        permission: "approve-discovery",
        owner: privateOwner("user_a"),
      }).kind,
    ).toBe("not-found");
  });

  it("reads the membership role and falls back to the Clerk org role", () => {
    expect(roleFromMembership({ role: "developer" }, "org:member")).toBe(
      "developer",
    );
    expect(roleFromMembership({}, "org:admin")).toBeNull();
    expect(roleFromMembership({}, "org:member")).toBeNull();
  });
});

describe("Clerk organization membership", () => {
  const previousDatabase = process.env.WEWEBPLUS_DATABASE_URL;
  const previousSecret = process.env.CLERK_SECRET_KEY;
  const previousPublishable = process.env.CLERK_PUBLISHABLE_KEY;

  afterEach(() => {
    verifyToken.mockReset();
    vi.unstubAllGlobals();
    clearSessionTokensForTesting();
    if (previousDatabase === undefined)
      delete process.env.WEWEBPLUS_DATABASE_URL;
    else process.env.WEWEBPLUS_DATABASE_URL = previousDatabase;
    if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousSecret;
    if (previousPublishable === undefined) {
      delete process.env.CLERK_PUBLISHABLE_KEY;
    } else process.env.CLERK_PUBLISHABLE_KEY = previousPublishable;
  });

  function sessionWithOrg() {
    delete process.env.WEWEBPLUS_DATABASE_URL;
    process.env.CLERK_SECRET_KEY = "sk_test_example";
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_example";
    verifyToken.mockResolvedValue({
      sub: "user_1",
      o: { id: "org_wewebplus" },
    });
  }

  it("asks Clerk for this user and keeps the membership", async () => {
    sessionWithOrg();
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          data: [
            {
              role: "org:admin",
              public_metadata: { role: "project-manager" },
              public_user_data: {
                user_id: "user_1",
                first_name: "Anak",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    await expect(
      defaultVerifySessionToken("session-token"),
    ).resolves.toMatchObject({
      userId: "user_1",
      orgId: "org_wewebplus",
      roleId: "project-manager",
      canInvite: true,
      displayName: "Anak",
      member: true,
    });
    expect(urls).toEqual([
      "https://api.clerk.com/v1/organizations/org_wewebplus/memberships?user_id=user_1",
    ]);
  });

  it("says the membership check failed when Clerk does not answer", async () => {
    sessionWithOrg();
    vi.stubGlobal(
      "fetch",
      async () => new Response("unavailable", { status: 503 }),
    );

    await expect(
      defaultVerifySessionToken("session-token"),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.External,
      message: "The membership check failed.",
    });
  });

  it("says the user is no longer a member when Clerk omits them", async () => {
    sessionWithOrg();
    rememberSessionToken(7, "session-token");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                role: "org:member",
                public_user_data: { user_id: "user_other" },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    await expect(
      resolveAccountSession({ sender: { id: 7 } }),
    ).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.Auth,
      message: "You are no longer a member of this organization.",
    });
  });
});
