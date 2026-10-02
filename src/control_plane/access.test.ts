import { describe, expect, it } from "vitest";
import { decideAccess, roleFromMembership } from "./access";
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
