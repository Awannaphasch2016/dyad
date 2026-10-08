# Integrate Forma with the shared sign-in

> This is a plan. It does not change the Forma application, does not deploy, and does not change the Clerk production instance.

Bolt is the first builder on the shared sign-in. Forma still asks for a workspace password. This plan is the copy Forma makes of Bolt's adapter.

## Verify

A line is done only when the observable result is true.

- [x] `forma` / `dev` has `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `WEWEBPLUS_DATABASE_URL`. The publishable key is a `pk_test_` key. The values are not printed.
  - Run [37838046506](https://github.com/Awannaphasch2016/dyad/actions/runs/37838046506) logged `forma_clerk_publishable=test`, `forma_clerk_secret=test`, and `forma_membership_roles=developer:1,project-manager:1`. The database name was present and did not contain `wewebplus.memberships`, so it was changed to a reference to `dyad` / `preview`.
- [x] The Forma page has a Sign in control. The workspace password field is gone.
  - Commit `53191a6e7b317f7927eaa77e10bbf3e2b996cad1` on `Awannaphasch2016/forma` branch `cursor/forma-shared-auth-5014`. The password field is not in that commit. A browser has not opened it yet, because this plan does not run the preview deploy.
- [ ] Signed out, the studio does not open. This waits for a preview deploy of commit `53191a6`.
- [ ] `anakwannaphaschaiyong@gmail.com` with Google sees Wewebplus and Project Manager.
- [ ] `awannaphasch2016@fau.edu` with Microsoft sees Wewebplus and Developer.
- [ ] Reload keeps the session. Sign out returns to the Sign in control.
- [ ] A project created by one account is not listed for the other account.
- [ ] `GET /api/status` still reports OpenRouter. A `pk_live_` key is not sent to the browser.

## Already true

- [PR 76](https://github.com/Awannaphasch2016/dyad/pull/76) defines the substrate. Clerk answers who is signed in. `wewebplus.memberships` answers the gate role. The question row holds a wait. Bolt does the work. The question row remains after the tab closes.
- [PR 78](https://github.com/Awannaphasch2016/dyad/pull/78) puts that adapter on the Bolt walkthrough at https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev. The session route returns `{ signedIn, organization, role }`. A removed Clerk membership is denied even when the role row remains. Exactly one gate role opens the workspace.
- Bolt reads `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `WEWEBPLUS_DATABASE_URL`. It allows one fixed walkthrough origin on the Development Clerk instance. It refuses a live key.
- Forma `lib/auth.ts` signs `studio_session` with `AUTH_SECRET`. The owner is `HMAC(AUTH_SECRET, "demo-owner")`. `POST /api/auth` checks `APP_PASSWORD`. `components/studio.tsx` says "Enter your workspace password."
- These Forma routes already call `ownerId()` and will follow the new session without a second role check: `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `app/api/projects/[id]/events/route.ts`, and `lib/job-route.ts`.
- `GET /api/cron` stays on `CRON_SECRET`. It is not a user session.
- `scripts/gascity/forma-sign-in.mjs` in this branch is the role decision: one Project Manager or Developer membership returns that role; zero or two do not.

## What this plan changes

Forma takes Bolt's sign-in. It does not take Bolt's Discovery, Implementation, and Delivery phase bar.

| Job                        | Forma after this plan                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Who is signed in           | Clerk Development session. The browser loads Clerk from `GET /api/clerk` and sends the session token.  |
| May this person act        | The Clerk organization membership still exists, and `wewebplus.memberships` has exactly one gate role. |
| What the studio stores     | Forma's own Neon database. `projects.owner_id` becomes the Clerk user id.                              |
| Who generates              | OpenRouter, as the current preview already does.                                                       |
| What survives a closed tab | The Clerk session and the project rows.                                                                |

The two people and the organization stay the ones Bolt already uses. There is no organization picker and no second role table.

## Prerequisites

Do these before changing the Forma page. Stop if a live key appears.

1. Confirm the three names above exist on Doppler `forma` / `dev`. The names recorded there earlier were the OpenRouter key, `APP_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, Neon, and Vercel. Clerk was not in that list. Use the same Development values Bolt already references. Do not copy them into `bolt` / `prd` or `dyad` / `prd`.
2. Confirm both Wewebplus membership rows already exist from the Bolt seed. This plan does not create a second pair of users.
3. Each Forma preview host is a new `https://forma-….vercel.app` origin. After the URL exists, add that origin to the Development Clerk instance `allowed_origins`, the same update Bolt makes for its one walkthrough origin. Do not add a production origin.

## Changes

### Forma repository

Commit these on a Forma branch. The preview deploys that commit. This repository does not patch them in at deploy time.

- `app/api/clerk/route.ts` returns the publishable key only when `clerkPublishable` accepts it.
- `lib/auth.ts` verifies the Clerk session token from `Authorization: Bearer` or the `__session` cookie, using the same checks as Bolt's `clerkUser`: `pk_test_` only, JWKS signature, expiry, and `sub`. `ownerId()` returns `formaOwnerId` of that session. The HMAC `studio_session` cookie is no longer written.
- `app/api/auth/route.ts` `GET` returns `{ signedIn, organization, role }`. `POST` no longer reads `APP_PASSWORD`.
- `components/studio.tsx` replaces the password field with the Sign in control Bolt uses: load Clerk, redirect to Clerk sign-in, show `Wewebplus · Project Manager` or `Wewebplus · Developer`, and sign out.
- `lib/config.ts` stops treating a missing `APP_PASSWORD` as a broken studio. `GET /api/status` must still be able to report OpenRouter.
- Tests that post a workspace password assert the Clerk session instead.

`ownerId()` is the only gate those project and job routes need. A signed-in person with no role receives the same refusal as a signed-out person: no project list and no job.

Projects already stored under the `demo-owner` hash stay in the database and do not appear for either Clerk user. They are not rewritten.

### This repository

`scripts/gascity/forma-sign-in.mjs` stays the tested decision. The Forma route calls that decision after it has loaded the Clerk user and the membership rows.

The preview runner is a later change, on the preview-forma branch. It uploads `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` to the Vercel preview target only, then adds the new deployment origin to the Development Clerk instance. This plan does not merge that workflow and does not run it.

## Check

Use Chrome on the Forma preview URL.

1. Signed out, the password field is absent and the studio does not list projects.
2. The normal window signs in with Google as `anakwannaphaschaiyong@gmail.com`. The header shows Wewebplus and Project Manager.
3. A private window signs in with Microsoft as `awannaphasch2016@fau.edu`. The header shows Wewebplus and Developer.
4. The Project Manager creates a project. The Developer does not see it. The Developer creates a different project. The Project Manager does not see it.
5. Reload either window. The session and that account's project remain.
6. Sign out. The studio asks for Sign in again.
7. `GET /api/status` is `{"configured":true,"provider":"openrouter"}`.

## Out of scope

- Bolt's shared phase, transcript, and delivery document. Forma does not grow that workflow in this copy.
- Vibe SDK.
- `bolt` / `prd`, `dyad` / `prd`, and the production Clerk instance.
- Merging `preview-forma` to `main`, deleting the Neon branch, or setting `APP_URL`.
- Copying `OPENROUTER_API_KEY` into any `OPENAI_*` name.

## Decision log

- The substrate to copy is the Clerk session and the Wewebplus role. The Bolt phase machine is a later shared project, and Forma does not need it to sign in.
- The password cookie is removed. Keeping it beside Clerk would leave a second owner id.
- The role decision is already tested in this repository. The JWT check and the page live in Forma, because the preview deploys the Forma commit.
- A new Vercel host is allowed on the Development Clerk instance after each preview deploy. A stable hostname is not required first.
