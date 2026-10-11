# Apps belong to the organization

An account is a permission on the organization’s apps. Creating an app uses the Project Manager permission. The app that appears still belongs to the organization.

This plan aligns the Vibe SDK app row and the code that reads it with that sentence. It does not change the shared `wewebplus` tables. Electron and Bolt still store a personal owner there.

## What the tables say today

Two databases are in this run. They do not use the same words.

**Membership, already a permission.** `wewebplus.memberships` is `user_id`, `org_id`, `role_id`. The role is `project-manager` or `developer`. This run only reads it. That table already says “this account has this role in this organization.” The Dyad permission list on those roles is the phase list (`approve-discovery`, `work-implementation`, and the rest). This product does not use that list.

**Shared apps, a personal owner.** `wewebplus.apps` requires `owner_type` (`user` or `org`) and `owner_id`. An app can belong to a person. `wewebplus.questions` requires `phase`. Those columns stay. Changing them breaks Electron, hitl-web, and Bolt.

**Vibe SDK app row, a creator treated as the owner.** The builder’s D1 `apps` row is written with `userId` (the account that pressed Enter) and `visibility` (`private` or `public`). This run then sets `org_id` and `created_by` on the same row. The header, the app list, delete, and the gallery button still read `userId`. `visibility` is the public-gallery flag: new apps are written `private`, the discover list shows `public`, and a private app’s sandbox preview is limited to `userId` unless this run’s organization check also allows it. The chip **Private** and the button **Make public** are that flag, drawn for the account in `userId`.

**Questions, already a role.** Vibe SDK `questions` stores `org_id`, `app_id`, `target_role_id`, `body`, `status`, and `assignment`. `answers` stores the account that answered, once. Those tables already match “a role may answer.” They do not say who the app belongs to.

## The words to use

| Word | Where it is stored | What it means |
| --- | --- | --- |
| Belongs to | `apps.org_id` | The organization. Every app has one. |
| May create | membership `role_id = project-manager` | This account may press Enter and start an app. |
| May open | membership in the same `org_id` | This account may open the app, the files, and the preview. |
| May answer | `questions.target_role_id` | This role may see the question and answer it once. |
| Created by | `apps.created_by` | The account that used May create. A record of the action. |
| Gallery | `apps.visibility` | `private` or `public` for the public catalog. Not belonging. |
| Builder bookkeeping | `apps.userId` | The same account as `created_by`. The builder writes it. No screen reads it as belonging. |

There is no owner column in this product. `created_by` and `userId` are the same fact written twice because the builder already has `userId`. Readers use `created_by` when they need “who started it,” and they use `org_id` when they need “whose app this is.”

## Code that still says the creator owns the app

These are the reads to change. The columns can stay.

- The chat header sets “owner” with `app.userId === current user`, then draws **Private** from `visibility` and **Make public** for that match.
- The app list loads rows with `apps.userId = current user`. The Project Manager sees the app there. The Developer is sent through a separate “Open the organization app” link.
- `checkAppOwnership` sets `isOwner` when `userId` matches or the account is an organization member. `deleteApp` uses that flag, so a member is treated as the owner.
- `updateAppVisibility` still allows the change only when `userId` matches, and the error text says “your own apps.”
- The home page hides the Developer’s Enter with the display string in `sessionStorage`. The server create check is the permission. The display string is not.

The question path, the waiting line, and the one answer already use the role. Leave them.

## Redesign

1. Keep writing `org_id` on create. It is required for every app this product creates. Access, the app list, and the header load apps by that column.
2. Keep writing `created_by` as the account that passed the Project Manager check. Do not read it for access, for the chip, or for delete.
3. Leave `userId` in place so the builder’s insert still succeeds. Set it to the same account as `created_by`. No permission and no screen uses it to decide belonging.
4. Leave `visibility` in place so the builder and the public catalog still have a gallery flag. Do not draw it. **Private** and **Make public** are removed for every role. Changing the flag and deleting the app are not granted by creating the app. Those actions stay unavailable until a membership permission names them. No such permission exists on these two roles today.
5. Opening and the sandbox preview use “membership `org_id` equals `apps.org_id`.” The `userId` fallback on a row that has no `org_id` is the old personal rule. Organization apps do not use it.
6. The app list uses the same organization lookup for both roles. The Developer-only link is removed.
7. Create stays a server check on membership role `project-manager`. The home page may hide Enter for the Developer as a reflection of that role. A forged display string cannot create the app.
8. Do not add an owner column, a personal app, or a second permission table. Do not alter `wewebplus.apps` or `wewebplus.questions`.

## Important changes

- An app belongs to the organization through `org_id`. Creating it does not make it the creator’s.
- `created_by` records which account used the create permission. It is not belonging.
- `userId` remains the builder’s copy of that same account. Nothing reads it as “this person’s app.”
- `visibility` remains the gallery flag. The header no longer shows **Private** or **Make public**.
- The Project Manager role may create. Both roles in the organization may open the app. The role named on a question may answer it.
- Delete and changing the gallery flag are not included in creating. They stay unavailable.
- The app list is the organization’s apps for both roles.
- Shared `wewebplus.apps` and `wewebplus.questions` stay as they are, including `owner_type` and `phase`.
