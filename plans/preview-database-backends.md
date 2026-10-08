# Preview labels per app

> Revised 2026-10-08 after reading `deploy/preview/transition.mjs` and the preview workflow.
>
> The label names the app. Dyad keeps the label it already has. Vibe SDK and Bolt get their own labels and their own databases. Cloudflare is not a label.

## Summary

A pull-request label creates an isolated public URL, the URL stays up, and removing that app's label deletes that app's preview. Closing the pull request deletes every app preview for it. Dyad stays on the `preview` label, Namespace, and a Neon branch. Vibe SDK uses `preview-vibesdk`, its own Worker, and an empty D1 database. Bolt uses `preview-bolt` and Bolt's own database vendor. Bolt can run on Cloudflare without using Vibe SDK's D1 database, KV, R2, Worker, or secrets.

## Problem Statement

Reviewers need a public URL that is isolated from production and from other pull requests. Dyad has that today. The `preview` label runs Namespace and creates Neon branch `preview-pr-<number>`. Vibe SDK does not. The lab is one shared Worker, `vibesdk-lab`, at `https://vibesdk-lab.karant-test-egress-canary.workers.dev`, republished by hand. D1 cannot branch, so Dyad's Neon strategy cannot be copied onto it.

Bolt also runs on Cloudflare and uses a different database vendor. A `preview-cloudflare` label would group those apps by host and hide that their databases, buckets, and secrets are different. The label has to name the app.

## What the current Dyad code actually does

`commandForPullRequest` in `deploy/preview/transition.mjs` compares the label with equality to the string `preview`.

- Adding `preview` returns `update`. Opening, reopening, or pushing while that label is present also returns `update`.
- Removing `preview` returns `destroy`.
- Closing the pull request returns `destroy` even when the label is already absent. The destroy script has to be safe to run twice.
- Opening, reopening, or pushing with no `preview` label returns `skip`. That rule exists so a push cannot delete a preview that was created before the label.
- Adding `preview` to a closed pull request returns `skip`.

`preview.yml` prints the URL as `preview_url=` in the Actions log. It has `pull-requests: read` and does not comment on the pull request.

The Dyad URL is `https://pr-<number>.anakwannaphaschaiyong.com`. Gas City is part of that same preview, at `https://gc-pr-<number>.anakwannaphaschaiyong.com`. It is not a separate label. Dyad deploys share one Namespace devbox lock, `preview-devbox-wewebplus-ci`.

## Scope

### In Scope (MVP)

- Leave `preview` as Dyad's only label. Do not add `preview-dyad`. A call that does not pass a label still means `preview`, so today's tests, `controller.mjs decide`, the Namespace devbox, the Neon branch name, the tunnel hostnames, and the compose project stay as they are.
- Add `preview-vibesdk`. Match it by equality. A `preview` event must not update or destroy a Vibe SDK preview, and a `preview-vibesdk` event must not update or destroy Dyad.
- Give that Vibe SDK preview its own Worker, empty D1 database, KV namespace, and R2 bucket, named `vibesdk-pr-<number>`.
- Publish `https://vibesdk-pr-<number>.karant-test-egress-canary.workers.dev` and set `CUSTOM_DOMAIN` to that host.
- Deploy the Vibe SDK pin and patches recorded in that pull request. This does not deploy the Dyad containers.
- Think calls OpenRouter directly. Do not create an AI Gateway per pull request.
- Delete only `vibesdk-pr-<number>` and its D1, KV, and R2 when `preview-vibesdk` is removed. Closing the pull request runs that same delete. The delete is a no-op when those resources were never created.
- Allow more than one `preview-vibesdk` pull request at a time. Creating one does not wipe another. Vibe SDK deploys use their own per-pull-request lock and do not take Dyad's devbox lock.
- Keep `vibesdk-lab` as the long-lived walkthrough. Refuse its Worker name, D1 name, and the production ids below.
- Reserve the label name `preview-bolt` for Bolt. Bolt's database is Bolt's vendor, not D1 and not Dyad's Neon project.

### Out of Scope (Follow-up)

- A Bolt workflow that runs before Bolt can provision a URL and a database. The name is reserved here. Shipping an empty workflow would let a reviewer add the label and get no URL.
- Renaming `preview` to `preview-dyad`.
- A public URL for an app generated inside Vibe SDK. This account cannot use Workers for Platforms, and the lab build omits the sandbox container.
- Dump and restore of preview data, a wiped shared database, or Postgres schemas inside one server.
- A Forma deploy. `preview-forma` can follow the same equality rule later.
- Changing Dyad's Neon parent, Clerk origins, or hostnames.
- Production Worker `vibesdk-production`, D1 `c4721a2b-b96a-428a-8b2a-b3d255b307e9`, KV `f066f3c2e4824981b48e8586c04db9c1`, R2 `vibesdk-templates`, or `build.cloudflare.dev`.
- Replacing the manual lab workflow.
- A `preview-cloudflare` label.

## User Stories

- As a reviewer, I want `preview` to keep opening Dyad and Gas City at the same hostnames so that current inspections do not move.
- As a reviewer, I want `preview-vibesdk` to open a Vibe SDK builder whose signups and chats stay on that pull request.
- As a reviewer, I want two Vibe SDK previews up at once, and I want removing one label to leave the other URL up.
- As a reviewer, I want a Dyad label and a Vibe SDK label on the same pull request to create two URLs, and I want removing one to leave the other serving.
- As a reviewer, I want Bolt, when it is ready, to use `preview-bolt` and Bolt's own database rather than Vibe SDK's D1 database.

## UX Design

### User Flow

1. The reviewer adds `preview` or `preview-vibesdk` to a pull request in this repository. The labels are independent.
2. Dyad keeps reporting through the Actions log. Vibe SDK comments "Provisioning", then replaces that with the URL.
3. Dyad stays on `https://pr-<number>.anakwannaphaschaiyong.com`. Vibe SDK is `https://vibesdk-pr-<number>.karant-test-egress-canary.workers.dev`.
4. The URL stays up until that app's label is removed or the pull request closes.
5. Vibe SDK's removal comment names the URL that was deleted. Dyad's removal stays in the Actions log.

`preview-bolt` is not offered to reviewers until Bolt's deploy exists.

### Key States

- **Default**: The label is present and the last deploy succeeded. Dyad's log line is `preview_url=`. Vibe SDK's comment shows the URL.
- **Loading**: Vibe SDK's comment says provisioning. An older URL for that same app and pull request keeps serving. Dyad's log stays on the previous run until the new one prints a URL.
- **Empty**: The Vibe SDK database has that checkout's schema and no users. The reviewer signs up on that URL.
- **Error**: That app's own status says it was not updated. Another app on the same pull request is left alone.

### Interaction Details

Reviewers add an app label. They do not choose a database or a cloud vendor. Dyad's status stays the Actions log. Vibe SDK's status is a pull-request comment, which needs `pull-requests: write` on `preview-vibesdk.yml` only.

### Accessibility

Vibe SDK's comment contains the app name and the full URL as text. Dyad's log line already contains the full URL.

## Technical Design

### Architecture

| Label             | App                      | Runtime                         | Database                                    | URL                                                                                                    |
| ----------------- | ------------------------ | ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `preview`         | Dyad, including Gas City | Namespace devbox `Wewebplus-ci` | Neon branch `preview-pr-<number>`           | `https://pr-<number>.anakwannaphaschaiyong.com` and `https://gc-pr-<number>.anakwannaphaschaiyong.com` |
| `preview-vibesdk` | Vibe SDK                 | Worker `vibesdk-pr-<number>`    | New empty D1 database for that pull request | `https://vibesdk-pr-<number>.karant-test-egress-canary.workers.dev`                                    |
| `preview-bolt`    | Bolt, later              | Bolt's own Cloudflare deploy    | Bolt's own vendor                           | Chosen with Bolt's deploy                                                                              |

Label matching is exact. `preview` does not match `preview-vibesdk` or `preview-bolt`.

Each new app copies the existing decision, with its own label string:

- Adding that label, or opening, reopening, or pushing while it is present, updates that app.
- Removing that label destroys that app.
- Closing the pull request destroys that app, and the destroy is a no-op when the app was never deployed.
- A push with that label absent does not destroy it.
- Adding that label to a closed pull request skips.

`.github/workflows/preview.yml` keeps today's Dyad jobs. It is not taught about D1, Wrangler, or Bolt.

`.github/workflows/preview-vibesdk.yml` is the Vibe SDK workflow. It creates and deletes only `vibesdk-pr-<number>` and that preview's D1, KV, and R2. Durable Object storage belongs to that Worker and is removed with the script. Think uses the OpenRouter key and does not need a new AI Gateway.

Vibe SDK's database operation is a new empty database. Apply that pull request's Vibe SDK migrations to it. D1 cannot branch. Time Travel restores one database in place and cannot make a second copy. Workers Paid allows 50,000 D1 databases, billed by queries and storage.

Dyad's database operation stays `ensurePreviewBranch` / `deletePreviewBranch`. The parent must be a sanitized Neon branch. `br-mute-shadow-b3jxqoho` stays refused.

Bolt's operation is not chosen yet. When it is, it lives in Bolt's workflow and does not call the D1 module or the Neon module.

Fork pull requests stay excluded.

### Components Affected

- `deploy/preview/transition.mjs` — add an optional label argument that defaults to `preview`. Omitting it keeps today's results, including close-without-label returning `destroy` and synchronize-without-label returning `skip`. `controller.mjs decide` does not gain a new flag.
- `scripts/gascity/preview-controller.test.mjs` — keep the current `preview` cases and add equality cases for `preview-vibesdk`.
- `.github/workflows/preview-vibesdk.yml` — new file.
- A D1 preview module next to `deploy/preview/neon.mjs`, used only by the Vibe SDK workflow.
- The manual lab script stays the walkthrough. Shared helpers must refuse the lab and production names.

### Data Model Changes

No Dyad schema change. Each Vibe SDK preview database contains only that checkout's migrations and the rows created on that URL.

### API Changes

No Dyad API change. The pull-request comment is the status.

## Implementation Plan

### Phase 1: Decision function

- [x] Add the optional label argument, default `preview`. The existing `preview` tests pass without editing their calls.
- [x] Test that `preview` and `preview-vibesdk` do not match each other.
- [x] Test close, unlabel, push-without-label, and label-on-a-closed-pull-request for `preview-vibesdk`.

### Phase 2: Vibe SDK preview

- [x] Create the Worker, empty D1 database, KV namespace, and R2 bucket for `vibesdk-pr-<number>`.
- [x] Migrate that D1 database only. Refuse the lab and production ids first.
- [x] Set `CUSTOM_DOMAIN` to the workers.dev host. Point Think at OpenRouter.
- [x] Comment the URL after health succeeds. Leave Dyad's `preview_url=` log as it is.
- [x] On unlabel or close, delete those resources. A second run of the delete finds nothing and succeeds.

### Phase 3: Bolt

- [ ] When Bolt's database vendor and hostname are known, add `preview-bolt` with the same decision rules and Bolt's own resources.

## Testing Strategy

- [x] The existing preview controller tests still pass without editing their expectations.
- [x] A new test shows that unlabeling `preview` while `preview-vibesdk` remains destroys only Dyad's command, and the reverse destroys only Vibe SDK's command.
- [ ] A disposable pair of pull requests with `preview-vibesdk`: both URLs healthy, a signup on one absent from the other.
- [ ] Remove `preview-vibesdk` from a pull request that also has `preview`. Dyad's URL still serves. The Vibe SDK Worker and D1 database are gone.
- [ ] Add `preview` alone. The Dyad URL is unchanged and no `vibesdk-pr-<number>` Worker exists.

## Risks & Mitigations

| Risk                                                                    | Likelihood | Impact | Mitigation                                                                               |
| ----------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------- |
| A prefix check treats `preview-vibesdk` as Dyad's label                 | Medium     | High   | Compare the whole label string. Tests cover both directions.                             |
| Vibe SDK jobs are inserted into `preview.yml`                           | Medium     | High   | Separate workflow file.                                                                  |
| Bolt and Vibe SDK share a D1 database because both use Cloudflare       | Medium     | High   | Bolt does not call the D1 module. Its workflow does not exist until its vendor is named. |
| A preview migrates `vibesdk-lab` or production D1                       | Low        | High   | Refuse those names and ids before create, migrate, or delete.                            |
| Close on every pull request deletes a database that was never created   | High       | Low    | Delete by the pull-request name and succeed when it is already gone.                     |
| Dyad deploys queue behind Vibe SDK builds                               | Low        | Medium | Vibe SDK does not use `preview-devbox-wewebplus-ci`.                                     |
| Reviewers add `preview-bolt` and get silence                            | Medium     | Medium | Do not register that workflow until Bolt can publish a URL.                              |
| Reviewers expect the generated app inside Vibe SDK to have a public URL | High       | Medium | The comment says the preview is the builder.                                             |

## Open Questions

- Bolt's database vendor and hostname. The label name is reserved. The workflow waits.
- Dyad keeps the Actions log. Vibe SDK uses a pull-request comment. `preview.yml` does not gain `pull-requests: write`.
- The Vibe SDK workflow uses the same Doppler OIDC identity as Dyad, reading `dyad/preview`. It does not receive the lab admin token.

## Decision Log

- Read the current decision function before adding labels. `preview` stays an exact match. Close still destroys, and destroy must no-op. Opening, reopening, or pushing without the label still does not destroy.
- The new label argument defaults to `preview`. Existing tests and `controller.mjs decide` stay unchanged.
- Dyad's status stays the Actions log. Only the Vibe SDK workflow comments on the pull request.
- Dropped `preview-dyad`. A second name for Dyad would change the unlabel rule the current tests lock in.
- Gas City stays inside the Dyad preview. It does not get its own label.
- `preview-vibesdk` is Vibe SDK's label. `preview-bolt` is reserved for Bolt. There is no `preview-cloudflare` label.
- Bolt on Cloudflare does not share Vibe SDK's database, KV, R2, Worker names, or secrets.
- Each non-branching app gets a new empty database per preview. Previews stay up together.
- D1 cannot branch. Time Travel is not a second database.
- Dyad's Neon branch stays `preview-pr-<number>` from a sanitized parent.
- `vibesdk-lab` remains the manual walkthrough.
- Generated-app hosting inside Vibe SDK stays deferred.
- The Bolt workflow stays deferred until its database vendor is named. The reserved label name is not a workflow yet.
- Vibe SDK preview uses Doppler OIDC against `dyad/preview`. The lab admin token is not given to that workflow.
- Vibe SDK preview does not use the Namespace devbox. Wrangler publishes the Worker directly.

---

_Revised after reading the preview label code._
