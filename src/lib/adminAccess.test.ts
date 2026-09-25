import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  clerkAccountPortalUrls,
  clerkDirectoryFromApi,
  roleFromMetadata,
} from "./adminAccess";

describe("admin access", () => {
  it("gives admin, reviewer, and dev their own permissions", () => {
    expect(ADMIN_ROLES.map((role) => role.id)).toEqual([
      "admin",
      "reviewer",
      "dev",
    ]);
    expect(ADMIN_ROLES[0]?.permissions.map((item) => item.label)).toEqual([
      "Approve discovery",
      "Approve implementation",
      "Approve delivery",
      "Manage members",
    ]);
    expect(ADMIN_ROLES[2]?.permissions.map((item) => item.label)).toEqual([
      "View the page",
      "Comment on a phase",
      "Work in implementation",
    ]);
  });

  it("reads a role from Clerk metadata and maps legacy member to reviewer", () => {
    expect(roleFromMetadata({ role: "admin" })).toBe("admin");
    expect(roleFromMetadata({ role: "reviewer" })).toBe("reviewer");
    expect(roleFromMetadata({ role: "dev" })).toBe("dev");
    expect(roleFromMetadata({ role: "member" })).toBe("reviewer");
    expect(roleFromMetadata({ role: "owner" })).toBe("reviewer");
    expect(roleFromMetadata(null)).toBe("reviewer");
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
          public_metadata: { role: "admin" },
        },
      ],
      [
        {
          id: "inv_9",
          email_address: "new@example.com",
          status: "pending",
          public_metadata: { role: "reviewer" },
        },
        {
          id: "inv_done",
          email_address: "done@example.com",
          status: "accepted",
          public_metadata: { role: "reviewer" },
        },
      ],
    );
    expect(members).toEqual([
      {
        id: "user_123",
        name: "Ada Lovelace",
        email: "ada@example.com",
        roleId: "admin",
        status: "active",
      },
      {
        id: "inv_9",
        name: "new@example.com",
        email: "new@example.com",
        roleId: "reviewer",
        status: "invited",
      },
    ]);
  });
});
