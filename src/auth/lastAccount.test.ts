import { describe, expect, it } from "vitest";
import {
  LAST_ACCOUNT_METADATA_KEY,
  readLastAccount,
  restoreLastAccount,
  withLastAccount,
} from "./lastAccount";

describe("last account", () => {
  it("reads a private choice and an organization id", () => {
    expect(readLastAccount(null)).toBeNull();
    expect(readLastAccount({ [LAST_ACCOUNT_METADATA_KEY]: "private" })).toBe(
      "private",
    );
    expect(readLastAccount({ [LAST_ACCOUNT_METADATA_KEY]: "org_1" })).toBe(
      "org_1",
    );
    expect(
      readLastAccount({ [LAST_ACCOUNT_METADATA_KEY]: "user_1" }),
    ).toBeNull();
  });

  it("restores the organization saved on another device", () => {
    expect(
      restoreLastAccount({
        saved: "org_1",
        activeOrganizationId: null,
        membershipOrganizationIds: ["org_1", "org_2"],
      }),
    ).toEqual({ kind: "organization", id: "org_1" });
  });

  it("returns to private when that was the saved choice", () => {
    expect(
      restoreLastAccount({
        saved: "private",
        activeOrganizationId: "org_1",
        membershipOrganizationIds: ["org_1"],
      }),
    ).toEqual({ kind: "private" });
  });

  it("leaves the session alone when the saved organization is gone", () => {
    expect(
      restoreLastAccount({
        saved: "org_gone",
        activeOrganizationId: null,
        membershipOrganizationIds: ["org_1"],
      }),
    ).toEqual({ kind: "keep" });
  });

  it("stores private as an explicit choice", () => {
    expect(withLastAccount({ theme: "dark" }, null)).toEqual({
      theme: "dark",
      [LAST_ACCOUNT_METADATA_KEY]: "private",
    });
  });
});
