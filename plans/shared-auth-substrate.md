# Shared authentication for the four builders

DYAD, Forma, Bolt, and Vibe SDK sign in through one Clerk application. The first check is two people in one organization, Wewebplus. Each builder keeps its own app database.

This plan does not change Clerk, does not delete users, and does not fill `bolt` / `prd`.

## What is already true

| Builder  | Sign-in today                                      | Where a person lives                         | Organization                                      |
| -------- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| DYAD     | Clerk widget                                       | Clerk, plus `wewebplus.memberships`          | Yes. A private account also exists.               |
| Forma    | One workspace password, `APP_PASSWORD`             | One `demo-owner` inside a signed cookie      | No                                                |
| Bolt     | None                                               | This browser's IndexedDB                     | No                                                |
| Vibe SDK | Email and password, Google, GitHub, or Cloudflare | D1 `users`, `sessions`, `user_oauth_identities` | No                                             |

Forma is `Awannaphasch2016/forma` at `c7f4fad`. The password check is `app/api/auth/route.ts`. The cookie is `studio_session` in `lib/auth.ts`. Projects in `db/schema.sql` are keyed by that one owner id.

Bolt is `Awannaphasch2016/bolt.diy` at `8584d65` on `cursor/website-walkthrough-55d6`. Password fields there save a GitHub, GitLab, Vercel, Netlify, or Supabase token. They do not create a Bolt user.

Vibe SDK is `Awannaphasch2016/vibesdk` at `9da158d`. Login is `worker/api/controllers/auth/controller.ts`. An app belongs to `users.id`. There is no organization table.

DYAD already verifies a Clerk session in the main process. The gate role is the row in `wewebplus.memberships`. Clerk `org:admin` can invite. It does not answer a gate. The seeded organization is `org_3JuOz4PCITqmueMeKYhcFUXAEIH`. Those user ids belong to the Clerk instance that created them. A different instance gives the same Gmail person a different user id.

## The substrate

One Clerk application.

| Instance    | Keys                    | Who uses it                                      |
| ----------- | ----------------------- | ------------------------------------------------ |
| Development | `pk_test_` / `sk_test_` | Local, dev, and every PR preview of all four builders |
| Production  | `pk_live_` / `sk_live_` | The production domain only                       |

A person is a Clerk user. Wewebplus is a Clerk organization. The role is a row in `wewebplus.memberships`: `project-manager` or `developer`.

A preview Neon branch holds the membership rows and the questions. DYAD, Forma, Bolt, and Vibe SDK each keep their own project database. Closing the preview drops the branch. The two Clerk users stay.

A session with one organization opens Wewebplus. The membership row still has `org_id`, so a later organization is another row and a selection step. This plan does not add organization creation.

`dyad` / `preview` holds the Development Clerk keys. `dyad` / `prd` holds the Production keys. Forma, Bolt, and Vibe preview configs reference the Development names. They do not reference `prd`. Before a preview uses the Development key, confirm it starts with `pk_test_`. A `pk_live_` value on preview means that preview is production, and the work stops.

## Seed

On the Development instance:

1. Sign in with the Gmail account. That user is Project Manager.
2. Sign in with the FU.edu Microsoft account. That user is Developer.
3. Both are members of Wewebplus.
4. Write those two Development user ids into `wewebplus.memberships` on the preview database branch.

The same two external accounts sign into Production later and receive Production user ids. Production memberships use those Production ids.

## Each builder

**DYAD.** Keep the Clerk session check and `decideAnswer`. The two-person check uses the Wewebplus organization. The account switcher stays able to show another organization later.

**Forma.** Replace the password cookie with the Clerk session. `ownerId()` returns the Clerk user id. Projects stay in Forma's Postgres and are listed for that user inside Wewebplus. `APP_PASSWORD` stops being the way in.

**Bolt.** Add a sign-in page that uses the Development publishable key. The question list reads the Clerk session and the membership row. Chat history can stay in the browser until a later plan. Bolt does not gain its own user table.

**Vibe SDK.** Product sign-in becomes the Clerk session. Apps stay in D1, stored under the Clerk user id and the Wewebplus org id. The existing email, Google, GitHub, and Cloudflare login is not the shared identity. This plan does not import or delete those D1 users.

## Check

Use Chrome on a computer. Open one builder that has the sign-in page.

- Normal window: Gmail account, Project Manager.
- Private window: FU.edu account, Developer.

1. Discovery. The Project Manager sees the question text and submits `approve` once. The Developer sees `Waiting on Project Manager for plan-approve.`
2. Implementation. The Developer submits `approve` once. The Project Manager sees the waiting line.
3. Delivery. The Project Manager submits `approve` once. The Developer sees the waiting line.

After each submit the status is `answered`, the field is gone, and the build stays paused.

## Left for later

Organization creation, a second organization, importing Vibe SDK's D1 users, and production keys on any preview. `bolt` / `prd` stays empty until this check passes.
