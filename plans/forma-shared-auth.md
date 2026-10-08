# Forma on the shared sign-in

Bolt already uses the shared sign-in. Forma does not. This plan is the Forma copy of that adapter. It does not deploy, and it does not change Clerk production.

## What was read

- [PR 76](https://github.com/Awannaphasch2016/dyad/pull/76), `plans/shared-auth-substrate.md` on `cursor/shared-auth-substrate-55d6`. Bolt is the first adapter. The plan says DYAD, Forma, and Vibe SDK stay unchanged until that adapter passes.
- [PR 78](https://github.com/Awannaphasch2016/dyad/pull/78), `plans/shared-hitl-workflow.md` and `scripts/doppler/bolt-hitl.mjs` on `cursor/shared-hitl-workflow-851d`. This is the Bolt implementation. The pull request says DYAD, Forma, and Vibe SDK are not in that change.
- `Awannaphasch2016/forma` `lib/auth.ts` and `app/api/auth/route.ts` on `main` and `cursor/forma-preview-walkthrough`.

## Status

|                       | Bolt                                                                  | Forma                                   |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| Sign-in               | Clerk Development session on the walkthrough                          | Workspace password `APP_PASSWORD`       |
| Cookie                | Clerk session cookie                                                  | `studio_session`, HMAC of `AUTH_SECRET` |
| Identity              | Clerk user id                                                         | One derived `demo-owner`                |
| Organization and role | Wewebplus, Project Manager or Developer, from `wewebplus.memberships` | None                                    |
| Shared project        | One Postgres project, polled by both browsers                         | Not present                             |

The walkthrough is https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev. PR 78 describes the two-browser check. Its text says that check is not claimed finished until someone walks through it. The session code is in the branch.

Forma has no Clerk file. `GET /api/auth` returns `{ authenticated: true }` when the password cookie verifies. `components/studio.tsx` still says "Enter your workspace password."

## What Forma copies

The sign-in adapter from PR 76, with the session shape Bolt already returns:

- The same Development Clerk application. A `pk_live_` or `sk_live_` key stops the work.
- The same two people: `anakwannaphaschaiyong@gmail.com` (Google, Project Manager) and `awannaphasch2016@fau.edu` (Microsoft, Developer).
- The same `wewebplus.memberships` rows. A removed Clerk membership denies access even if the role row remains.
- One organization, so there is no organization picker.
- `formaSession` in `scripts/gascity/forma-sign-in.mjs` is the decision the Forma route will call. Zero or two gate roles leave the person signed in with no workspace. One role returns `Wewebplus` and `Project Manager` or `Developer`. The owner id is the Clerk user id.

Forma keeps its own Neon database for studio projects. That database is not a second definition of the roles.

## In scope

1. Confirm `forma` / `dev` has `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` as references to the Development instance, the same names Bolt reads. The names recorded for that config earlier are the OpenRouter key, `APP_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, Neon, and Vercel. Clerk was not in that list. Do not deploy until the names are present, and do not print the values.
2. Replace the password form in `components/studio.tsx` with the Clerk sign-in control.
3. Change `app/api/auth/route.ts` so `GET` returns the session above, and `POST` no longer accepts `APP_PASSWORD`.
4. Change `lib/auth.ts` so `ownerId()` is the Clerk user id from `formaOwnerId`. Routes that already call `ownerId()` then require that session.
5. Show `Wewebplus · Project Manager` or `Wewebplus · Developer` on the studio page.
6. Keep `APP_URL` unset. Do not copy the OpenRouter key into any `OPENAI_*` name.

## Out of scope

- Bolt's Discovery, Implementation, and Delivery phase machine inside the Forma studio. That is the shared project in PR 78. Forma does not grow that phase bar in this copy.
- Vibe SDK.
- `bolt` / `prd`, `dyad` / `prd`, and the production Clerk instance.
- Merging the preview-forma workflow. That is a separate branch.

## Check

On a Forma preview, in Chrome:

- Signed out: the studio does not open, and a wrong password is not the sign-in path.
- Normal window, Google `anakwannaphaschaiyong@gmail.com`: the page shows Wewebplus and Project Manager.
- Private window, Microsoft `awannaphasch2016@fau.edu`: the page shows Wewebplus and Developer.
- Reload keeps the session. Sign out returns to the sign-in control.
- A `pk_live_` key is not served to the page.

## Decision log

- Forma was left out of PR 76 and PR 78 on purpose. Bolt's adapter now exists, so Forma is the next copy.
- The password cookie is retired for this preview. It is not kept beside Clerk.
- The session function lives in this repository first so the role rule is tested before the Forma page changes.
