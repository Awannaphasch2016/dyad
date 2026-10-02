import assert from "node:assert/strict";
import test from "node:test";
import { chooseMembership } from "./membership.ts";

test("a Clerk session org wins when the user belongs to it", () => {
  const chosen = chooseMembership(
    [
      { orgId: "org_other", roleId: "developer" },
      { orgId: "org_3JuOz4PCITqmueMeKYhcFUXAEIH", roleId: "project-manager" },
    ],
    "org_other",
  );
  assert.equal(chosen?.orgId, "org_other");
  assert.equal(chosen?.roleId, "developer");
});

test("without a session org, Wewebplus is the membership", () => {
  const chosen = chooseMembership(
    [
      { orgId: "org_other", roleId: "developer" },
      { orgId: "org_3JuOz4PCITqmueMeKYhcFUXAEIH", roleId: "project-manager" },
    ],
    null,
  );
  assert.equal(chosen?.roleId, "project-manager");
});

test("a session org the user is not in is absent", () => {
  assert.equal(
    chooseMembership(
      [{ orgId: "org_3JuOz4PCITqmueMeKYhcFUXAEIH", roleId: "developer" }],
      "org_other",
    ),
    null,
  );
});
