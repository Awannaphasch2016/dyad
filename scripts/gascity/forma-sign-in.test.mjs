import assert from "node:assert/strict";
import test from "node:test";
import {
  clerkKeyKind,
  clerkPublishable,
  formaOwnerId,
  formaSession,
} from "./forma-sign-in.mjs";

const manager = {
  org_id: "org_wewebplus",
  role_id: "project-manager",
};
const developer = {
  org_id: "org_wewebplus",
  role_id: "developer",
};

test("a live Clerk key is refused before a session is opened", () => {
  assert.equal(clerkKeyKind("pk_test_example"), "test");
  assert.equal(clerkKeyKind("sk_live_example"), "live");
  assert.equal(clerkPublishable("pk_live_example").status, 404);
  assert.equal(clerkPublishable("pk_test_example").status, 200);
  assert.equal(
    clerkPublishable("pk_test_example").body.publishableKey,
    "pk_test_example",
  );
});

test("one Wewebplus membership becomes the Forma session", () => {
  const session = formaSession({
    userId: "user_pm",
    memberships: [manager],
    activeOrgIds: ["org_wewebplus"],
    orgNames: { org_wewebplus: "Wewebplus" },
  });
  assert.deepEqual(session, {
    signedIn: true,
    organization: "Wewebplus",
    role: "Project Manager",
    userId: "user_pm",
  });
  assert.equal(formaOwnerId(session), "user_pm");
  assert.equal(
    formaSession({
      userId: "user_dev",
      memberships: [developer],
      activeOrgIds: ["org_wewebplus"],
      orgNames: { org_wewebplus: "Wewebplus" },
    }).role,
    "Developer",
  );
});

test("a removed membership or a second role does not grant a workspace", () => {
  assert.deepEqual(
    formaSession({
      userId: "user_pm",
      memberships: [manager],
      activeOrgIds: [],
    }),
    { signedIn: true, organization: null, role: null, userId: "user_pm" },
  );
  assert.equal(
    formaOwnerId(
      formaSession({
        userId: "user_pm",
        memberships: [manager, developer],
        activeOrgIds: ["org_wewebplus"],
      }),
    ),
    null,
  );
  assert.deepEqual(formaSession({}), {
    signedIn: false,
    organization: null,
    role: null,
    userId: null,
  });
});
