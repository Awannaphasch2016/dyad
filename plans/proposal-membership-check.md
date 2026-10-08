# Check one Clerk membership before rejecting a proposal

> Plan for the Implementation page that shows "Error loading proposal: You are no longer a member of this organization."

## Summary

The chat row and the app row are present. `getProposal` finds both, then asks Clerk for the first 100 members of the organization named in the session token. Any failed Clerk response, and any page that does not contain this user id, becomes `member: false`. That throws "You are no longer a member of this organization." The membership table in the control-plane database is read only after Clerk has already returned this user, so a stored row cannot change the result.

## Problem

`fetchOrgMembership` in `src/control_plane/access.ts` calls:

`GET /v1/organizations/{orgId}/memberships?limit=100`

A response that is not successful returns null. A successful page is scanned for `public_user_data.user_id`. No match also returns null. `resolveAccountSession` then throws the membership sentence whenever the token has an organization id and `member` is false.

`stampOrganizationAdmin` in `src/ipc/handlers/clerk_handlers.ts` already asks Clerk for one user:

`GET /v1/organizations/{orgId}/memberships?user_id={userId}`

The proposal path does not use that query. `readMembershipRole` runs only after a Clerk match, so the control-plane `memberships` table is skipped on this failure. That table is seeded with two user ids only.

## Scope

### In scope

- Ask Clerk for this user id, using the same `user_id` query `stampOrganizationAdmin` already uses.
- A Clerk response that is not successful throws a `DyadError` with `DyadErrorKind.External` and a message that the membership check failed. It does not say the user was removed.
- A successful Clerk response that does not include this user id still throws "You are no longer a member of this organization."
- After Clerk returns this user, keep reading the control-plane role with `readMembershipRole`.
- Tests for a matching `user_id` result, a failed Clerk response, and a successful response that omits the user.

### Out of scope

- Writing the signed-in user into the control-plane `memberships` table.
- Copying a stored row into Clerk.
- Changing the two seeded user ids.
- The browser-bridge keep-app path. That fix is already on pre.
- When the proposal query runs.

## Fix

1. Change `fetchOrgMembership` to request `/v1/organizations/{orgId}/memberships?user_id={userId}`.
2. When Clerk does not return a successful response, throw the external error from that function. Do not map it to `member: false`.
3. When Clerk succeeds and the page has no matching `public_user_data.user_id`, keep `member: false` and the current membership sentence.
4. Leave `membershipRoleFromControlPlane` where it is, on the path after a Clerk match.

## Verify on pre

1. Open the same Implementation chat with the same signed-in account.
2. If Clerk has this user in the organization named by the session, the red line "Error loading proposal: You are no longer a member of this organization." is gone.
3. If Clerk cannot answer, the line says the membership check failed. It does not say the membership was removed.
4. The Implementation chat still writes files, and the preview log still shows Vite updates.
5. A session with no organization still loads a proposal.
