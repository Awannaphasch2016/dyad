import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  clerkAccountPortalUrls,
  clerkDirectoryFromApi,
  roleFromClerkMembership,
  roleFromMetadata,
} from "./adminAccess";

describe("admin access", () => {
  it("gives project manager and developer their own permissions", () => {
    expect(ADMIN_ROLES.map((role) => role.id)).toEqual([
      "project-manager",
      "developer",
    ]);
    expect(ADMIN_ROLES[0]?.permissions.map((item) => item.label)).toEqual([
      "Approve discovery",
      "Approve implementation",
      "Approve delivery",
      "View the page",
      "Comment on a phase",
    ]);
    expect(ADMIN_ROLES[1]?.permissions.map((item) => item.label)).toEqual([
      "View the page",
      "Comment on a phase",
      "Work in implementation",
    ]);
  });

  it("reads only gate roles and does not invent one for an unknown person", () => {
    expect(roleFromMetadata({ role: "project-manager" })).toBe("project-manager");
    expect(roleFromMetadata({ role: "developer" })).toBe("developer");
    expect(roleFromMetadata({ role: "admin" })).toBeNull();
    expect(roleFromMetadata({ role: "reviewer" })).toBeNull();
    expect(roleFromMetadata({ role: "dev" })).toBeNull();
    expect(roleFromMetadata({ role: "member" })).toBeNull();
    expect(roleFromMetadata(null)).toBeNull();
  });

  it("does not turn Clerk org:admin into a gate role", () => {
    expect(roleFromClerkMembership({}, "org:admin")).toBeNull();
    expect(roleFromClerkMembership(null, "admin")).toBeNull();
    expect(roleFromClerkMembership({}, "org:member")).toBeNull();
    expect(
      roleFromClerkMembership({ role: "developer" }, "org:admin"),
    ).toBe("developer");
  });

  it("builds the Account Portal links from a publishable key", () => {
    const host = "example.clerk.accounts.dev";
    const key = `pk_test_${Buffer.from(`${host}$`).toString("base64").replace(/=+$/, "")}`;
    expect(clerkAccountPortalUrls(key)).toEqual({
      signInUrl: `https://${host}/sign-in`,
      signUpUrl: `https://${host}/sign-up`,
    });
    expect(clerkAccountPortalUrls("not-a-key")).toEqual({
      signInUrl: null,
      signUpUrl: null,
    });
  });

  it("builds Account Portal links in the renderer, where Buffer is missing", () => {
    const host = "example.clerk.accounts.dev";
    const key = `pk_test_${Buffer.from(`${host}$`).toString("base64").replace(/=+$/, "")}`;
    const buffer = globalThis.Buffer;
    // @ts-expect-error The renderer page does not provide Node's Buffer.
    delete globalThis.Buffer;
    try {
      expect(clerkAccountPortalUrls(key).signInUrl).toBe(
        `https://${host}/sign-in`,
      );
    } finally {
      globalThis.Buffer = buffer;
    }
  });

  it("lists active people and pending invitations with their roles", () => {
    const members = clerkDirectoryFromApi(
      [
        {
          id: "user_123",
          first_name: "Ada",
          last_name: "Lovelace",
          primary_email_address_id: "email_1",
          email_addresses: [
            { id: "email_1", email_address: "ada@example.com" },
          ],
          public_metadata: { role: "project-manager" },
        },
      ],
      [
        {
          id: "inv_9",
          email_address: "new@example.com",
          status: "pending",
          public_metadata: { role: "developer" },
        },
        {
          id: "inv_done",
          email_address: "done@example.com",
          status: "accepted",
          public_metadata: { role: "developer" },
        },
      ],
    );
    expect(members).toEqual([
      {
        id: "user_123",
        name: "Ada Lovelace",
        email: "ada@example.com",
        roleId: "project-manager",
        status: "active",
      },
      {
        id: "inv_9",
        name: "new@example.com",
        email: "new@example.com",
        roleId: "developer",
        status: "invited",
      },
    ]);
  });
});
