# Each member can create an organization they own

> Written 2026-09-27. This is the new requirement. It replaces the earlier idea that only an organization account may create organizations.

## Summary

Every signed-in person, including someone who was invited into another organization, can create an organization of their own. That new organization is a separate account. The creator is its owner and admin. Other people join it only when that admin invites them by email. Apps stay in the account that created them.

The work is one change set: make Create organization finish, and keep the button available to every signed-in member.

## Problem Statement

A member of an organization needs a place they control. Today the account menu shows **Create organization** to every signed-in person, and Clerk creates the organization in the browser. wewebplus then asks Clerk to record the creator as admin by calling `GET /v1/organizations/{id}/memberships/{userId}`. That URL accepts PATCH and DELETE only, so Clerk returns 405 and the toast says the create failed. The member cannot rely on the new organization.

## Scope

### In scope

- Create organization stays available on Private and while a member is inside an organization they were invited to.
- The creator of the new organization is its owner and admin (`org:admin` and membership role `admin`).
- The active account switches to the new organization, and that choice is remembered for the next sign-in.
- Other people join that organization only by an email invitation from its admin.
- A reviewer or a dev of someone else's organization can still create their own organization. They cannot invite people into an organization they do not administer.
- Fix the 405 by reading the membership from the list endpoint Clerk allows, then updating that membership.

### Out of scope

- Nested organizations. A new organization is not a child of the current one.
- Moving or copying apps between a member's own organization and an organization that invited them.
- Open join, join codes, or adding a member without an invitation.
- A limit on how many organizations one person may create. If a limit is needed later, it belongs in the Clerk dashboard.
- Changing the admin, reviewer, and dev labels.

## User stories

- As a signed-in member of Anak's Organization, I want to create my own organization so that I own its apps and its member list.
- As that creator, I want to be the admin immediately so that I can invite people by email.
- As an admin, I want invitations to be the only way in, so that a member cannot add themselves to an organization they do not own.
- As a member of two organizations, I want the account menu to list both, plus Private, so that I can switch without mixing their apps.

## UX

1. The person is signed in. The account menu shows Private, every organization they belong to, and **Create organization**.
2. They type a name and submit.
3. The menu switches to the new organization. Its apps list is empty until they create an app there.
4. On **Members & permissions** for that organization, they are the admin and can invite by email.
5. The invited person accepts with their own sign-in. The organization appears in their account menu. They can later create a different organization of their own.

States:

- **Signed out**: no Create organization control. The title bar shows Sign in.
- **Private**: Create organization is available. The private account still has no member list.
- **Member of another organization**: Create organization is still available. Creating one does not leave the old organization. Both remain in the menu.
- **Error**: if Clerk rejects the name, the toast shows Clerk's message and the previous account stays selected. A 405 must not appear for a successful create.

## Technical design

Clerk's browser `createOrganization` already lets any signed-in user create an organization and makes that user `org:admin`. The app must not hide the control for reviewers or devs.

`stampOrganizationAdmin` in `src/ipc/handlers/clerk_handlers.ts` currently GETs `/v1/organizations/{organizationId}/memberships/{userId}`. Change that read to `GET /v1/organizations/{organizationId}/memberships?user_id={userId}`, which is the list endpoint. If the returned role is `org:admin` or `admin`, PATCH the same membership with `role: "org:admin"` and `public_metadata.role: "admin"`. If the user is only `org:member`, refuse. An invited member still cannot stamp themselves admin of an organization they do not own.

Files:

- `src/ipc/handlers/clerk_handlers.ts` — read the membership from the list, then PATCH.
- `src/ipc/handlers/account_access.test.ts` — the creator test must expect the list GET, then the PATCH. The invited-member test must still refuse without a PATCH.
- `src/auth/AccountSwitcher.tsx` — no new gate. After a successful stamp, keep switching to the new organization.
- `docs/clerk-auth.md` — say a member of one organization may create another organization that they own.

No database migration. No new IPC channel. The iPad bridge session slot stays as it is.

## Implementation

- [ ] Replace the single-membership GET with the membership list filtered by `user_id`.
- [ ] Keep the PATCH that sets Clerk role `org:admin` and membership role `admin`.
- [ ] Update the creator and invited-member tests to the list response shape.
- [ ] Record the rule in `docs/clerk-auth.md`.
- [ ] On iPad, as a member of an existing organization, create a second organization and confirm it appears in the account menu, the creator can open invite, and the first organization's apps stay in the first organization.

## Testing

- [ ] Unit: creator stamp uses GET on `/memberships?user_id=` and then PATCH `org:admin` plus `public_metadata.role = admin`.
- [ ] Unit: an `org:member` stamp is refused and does not PATCH.
- [ ] Unit: a signed-out Electron window still does not clear the iPad session token.
- [ ] Manual: member of organization A creates organization B, invites someone to B, and does not see A's apps while B is selected.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Clerk already created the organization before the 405, so the name looks taken on retry | Medium | Low | Pick a new name, or select the organization if it is already in the menu |
| The list call returns more than the creator | Low | Low | Match `user_id` and require `org:admin` before the PATCH |
| A member expects the new organization to contain the parent organization's apps | Medium | Medium | The menu switches to an empty organization. Apps stay where they were created |

## Assumptions

- "Each member" means every signed-in person, including a reviewer or dev who was invited somewhere else.
- The new organization is a sibling account, not a child organization.
- Joining someone else's organization stays invite-only.
- The effort stays this one change set. A quota, nested organizations, or cross-account copy would be a later requirement.

## Decision log

- Keep Create organization on the signed-in account menu instead of adding an admin-only gate.
- Read membership through Clerk's list endpoint because GET on the single membership URL returns 405.
- Leave cross-account move and copy removed.
