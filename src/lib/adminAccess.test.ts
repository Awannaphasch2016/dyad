import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  clerkAccountPortalUrls,
  clerkDirectoryFromApi,
  roleFromMetadata,
} from "./adminAccess";

describe("admin access", () => {
  it("gives Admin and Member their own permissions", () => {
    expect(ADMIN_ROLES.map((role) => role.name)).toEqual(["Admin", "Member"]);
    expect(ADMIN_ROLES[0]?.permissions.map((item) => item.label)).toEqual([
      "Approve Discovery",
      "Approve Implementation",
      "Approve Delivery",
      "Manage members",
    ]);
    expect(ADMIN_ROLES[1]?.permissions.map((item) => item.label)).toEqual([
      "View the page",
      "Comment on a phase",
    ]);
  });

  it("reads a role from Clerk metadata and defaults the rest to Member", () => {
    expect(roleFromMetadata({ role: "admin" })).toBe("admin");
    expect(roleFromMetadata({ role: "member" })).toBe("member");
    expect(roleFromMetadata({ role: "owner" })).toBe("member");
    expect(roleFromMetadata(null)).toBe("member");
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
          public_metadata: { role: "member" },
        },
        {
          id: "inv_done",
          email_address: "done@example.com",
          status: "accepted",
          public_metadata: { role: "member" },
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
        roleId: "member",
        status: "invited",
      },
    ]);
  });
});
