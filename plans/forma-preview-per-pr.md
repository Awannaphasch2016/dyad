# Forma preview per pull request

> Revised 2026-10-08 from `plans/preview-database-backends.md` on `cursor/preview-backend-plan-fd29`.
>
> This is a plan. It does not create a Neon branch and it does not start a deployment.

## Summary

`preview-forma` is Forma's label. Adding it to a pull request in `Awannaphasch2016/forma` creates one isolated preview of that pull request. The preview is a Vercel deployment of that commit and one Neon branch named `forma-pr-<number>` in Neon project `divine-credit-21002460`. Removing the label, or closing the pull request, deletes that branch and that deployment. Another pull request's preview stays up.

Forma does not use Devbox `Wewebplus-ci`, the hostname `pr-<number>.anakwannaphaschaiyong.com`, or Dyad's Neon branch `preview-pr-<number>`.

## Problem Statement

Reviewers need a public URL for one Forma pull request that cannot see another pull request's projects or chats. The shared Forma database is the root branch `br-round-night-b33xeq5p`. One shared database would mix those rows.

Vibe SDK cannot copy Dyad's Neon branch because D1 cannot branch, so `preview-vibesdk` creates an empty D1 database named `vibesdk-pr-<number>`. Neon can branch. Forma's preview uses a Neon branch, which is the same isolation rule with Forma's own database.

## What the reference plan already decided

`commandForPullRequest` in `deploy/preview/transition.mjs` matches the whole label string `preview`. These rules are copied for `preview-forma` with that exact string:

- Adding the label returns `update`. Opening, reopening, or pushing while the label is present also returns `update`.
- Removing the label returns `destroy`.
- Closing the pull request returns `destroy` even when the label is already absent. Destroy is safe to run twice.
- Opening, reopening, or pushing without the label returns `skip`. A push does not delete a preview.
- Adding the label to a closed pull request returns `skip`.

`preview` does not match `preview-forma`, `preview-vibesdk`, or `preview-bolt`. A Forma event does not update or destroy Dyad or Vibe SDK.

## Scope

### In scope

- Label `preview-forma` on pull requests in `Awannaphasch2016/forma`. Match it by equality.
- One Vercel preview deployment of that pull request's head.
- One Neon branch `forma-pr-<number>` in project `divine-credit-21002460`. The parent is `br-round-night-b33xeq5p`. The branch is created with schema only, so rows on the parent are not copied.
- Apply `db/schema.sql` to that branch's direct host before the site serves. The server uses that branch's pooled host.
- Give that deployment its own `DATABASE_URL` and `APP_URL`. Copy `OPENROUTER_API_KEY`, `APP_PASSWORD`, and `AUTH_SECRET` from Doppler `forma/dev`. Do not print the values.
- Comment the Vercel preview URL on the Forma pull request after the deployment is ready.
- Delete only `forma-pr-<number>` and that pull request's Vercel preview when the label is removed or the pull request closes. A second delete finds nothing and succeeds.
- More than one `preview-forma` pull request can stay up. Creating one does not wipe another.

### Out of scope

- Devbox `Wewebplus-ci`, Compose project `forma-dev`, and `https://pr-<number>.anakwannaphaschaiyong.com`. That hostname stays Dyad's.
- Neon project `mute-credit-71067312`, branch name `preview-pr-<number>`, and parent `br-mute-shadow-b3jxqoho`.
- Neon project `proud-salad-68182047` and host `ep-young-wave-b3cwe0rz`.
- Doppler `dyad/prd` and `vibesdk/prd`.
- `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, and `OPENAI_WEBHOOK_SECRET`.
- Vibe SDK's Worker, D1, KV, and R2. Bolt's database. Gas City.
- A public URL for an app generated inside a Forma preview. That app's preview URL is the Vercel Sandbox URL recorded by Forma, not a second hostname from this plan.
- Deleting the parent branch `br-round-night-b33xeq5p`.

## User stories

- As a reviewer, I want `preview-forma` on a Forma pull request to open that commit, with projects and chats that no other pull request can see.
- As a reviewer, I want two Forma previews up at once, and I want removing one label to leave the other URL up.
- As a reviewer, I want a Dyad `preview` label and a Forma label to create two different URLs and two different databases.
- As a reviewer, I want closing the pull request to remove the Forma branch even if the label was already removed.

## UX

1. The reviewer adds `preview-forma` to a pull request in `Awannaphasch2016/forma`.
2. The pull request comment says provisioning, then replaces that with the Vercel preview URL.
3. The reviewer signs in with `APP_PASSWORD` from Doppler `forma/dev`.
4. The URL stays up until the label is removed or the pull request closes.
5. The removal comment names the URL that was deleted.

The comment contains the app name and the full URL as text.

## Technical design

| Label             | Repository               | Runtime                             | Database                                                    | URL                                                                 |
| ----------------- | ------------------------ | ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `preview`         | `Awannaphasch2016/dyad`  | Namespace devbox `Wewebplus-ci`     | Neon branch `preview-pr-<number>` in `mute-credit-71067312` | `https://pr-<number>.anakwannaphaschaiyong.com`                     |
| `preview-vibesdk` | `Awannaphasch2016/dyad`  | Worker `vibesdk-pr-<number>`        | New empty D1 database `vibesdk-pr-<number>`                 | `https://vibesdk-pr-<number>.karant-test-egress-canary.workers.dev` |
| `preview-forma`   | `Awannaphasch2016/forma` | Vercel preview of that pull request | Neon branch `forma-pr-<number>` in `divine-credit-21002460` | The Vercel preview URL written on the pull request                  |

The workflow file is `.github/workflows/preview-forma.yml` in `Awannaphasch2016/forma`, so the label event is visible. It checks out that pull request's head. It does not run `preview.yml` and it does not take the lock `preview-devbox-wewebplus-ci`.

Doppler `forma/dev` is read with a service token scoped to that config. The dyad admin token is not copied into the Forma repository. The service token is stored as a Forma Actions secret and is not printed.

`pnpm vercel-build` applies `db/schema.sql` and then builds. The schema file is one multi-statement script, so the migrate step uses the branch's direct host. The running deployment receives the pooled host. `CREATE TABLE IF NOT EXISTS` makes a second migrate safe.

The Forma app's `.env.example` still lists the OpenAI names. This preview does not copy `OPENROUTER_API_KEY` into `OPENAI_API_KEY`. A prompt works after `Awannaphasch2016/forma` reads `OPENROUTER_API_KEY` and calls `https://openrouter.ai/api/v1`. The password page does not wait for that change.

Fork pull requests are excluded.

## Phases

### Phase 1: Decision

- [ ] Match the label `preview-forma` by equality, using the same update, destroy, and skip rules as `preview`.
- [ ] A test shows that unlabeling `preview` does not destroy Forma, and unlabeling `preview-forma` does not destroy Dyad.
- [ ] Close, unlabel, push-without-label, and label-on-a-closed-pull-request behave as they do for `preview-vibesdk`.

### Phase 2: Neon branch

- [ ] Create `forma-pr-<number>` under `divine-credit-21002460` with parent `br-round-night-b33xeq5p` and schema only.
- [ ] Refuse `mute-credit-71067312`, `proud-salad-68182047`, `br-mute-shadow-b3jxqoho`, and `ep-young-wave-b3cwe0rz` before create, migrate, or delete.
- [ ] Apply `db/schema.sql` on the direct host. The log contains `Database schema ready.` and that host.
- [ ] On destroy, delete `forma-pr-<number>` only. The parent branch remains.

### Phase 3: Vercel preview

- [ ] Deploy that pull request's head to the Vercel project connected to `Awannaphasch2016/forma`.
- [ ] Set that deployment's `DATABASE_URL` to the pooled URL of `forma-pr-<number>`, and `APP_URL` to the preview origin.
- [ ] Pass `OPENROUTER_API_KEY`, `APP_PASSWORD`, and `AUTH_SECRET` from `forma/dev`. Do not set the four OpenAI names.
- [ ] Comment the preview URL after the deployment is ready.
- [ ] On destroy, delete that deployment. A second destroy succeeds.

## Testing

- [ ] Two labeled Forma pull requests are both healthy. A project created on one is absent from the other.
- [ ] Removing `preview-forma` from one pull request leaves the other URL up and leaves Dyad's `preview-pr-<number>` branch in place.
- [ ] Closing a labeled pull request deletes `forma-pr-<number>`. Running the delete again succeeds.
- [ ] The log does not contain a database URL, an API key, `mute-credit-71067312`, or `proud-salad-68182047`.

## Done when

- [ ] The pull request comment shows one Vercel preview URL.
- [ ] Neon project `divine-credit-21002460` contains branch `forma-pr-<number>` and still contains `br-round-night-b33xeq5p`.
- [ ] That URL returns HTTP 200 from the Forma app.
- [ ] The migrate log names the direct host of `forma-pr-<number>`, not `ep-young-wave-b3cwe0rz`.

## Decision log

- Read the Vibe SDK preview plan before choosing the database. D1 gets a new empty database because it cannot branch. Forma gets a Neon branch because it can.
- The branch name is `forma-pr-<number>`, not `preview-pr-<number>`, so a log cannot confuse it with Dyad.
- The parent is the Forma root branch. Schema only. Rows are not copied.
- The label is on `Awannaphasch2016/forma` pull requests because that is the commit being previewed.
- The runtime is Vercel. Devbox was the Dyad preview path and is not used here.
- The recorded URL is the Vercel preview URL. `pr-<number>.anakwannaphaschaiyong.com` stays Dyad's.
- OpenRouter stays `OPENROUTER_API_KEY`. The OpenAI names are not filled with that value.
