# Deploy Forma in Dev

> Written 2026-10-07. This is a plan. It does not start a container.

## Summary

Forma gets a public walkthrough URL by using the existing Preview workflow as the Dev deployment. The page is this app's browser bridge. The database is Neon project `divine-credit-21002460`. The address is `https://pr-<pull-request>.anakwannaphaschaiyong.com`.

Labeling a pull request today does not do this. The deploy job reads Doppler `dyad/preview`, then `deploy/preview/controller.mjs attach` replaces the database URL with a new child of Wewebplus-hitl. `scripts/gascity/preview-up.sh` also exits before it prints `preview_url` when the Gas City poller fails.

## Environment

Dev is the hosted stage. Preview is the mechanism inside it: one labeled pull request, one Compose project `preview-<n>`, one hostname `pr-<n>.anakwannaphaschaiyong.com`, on Devbox `Wewebplus-ci`.

Canary and Production are unchanged. This plan does not SSH, does not use `/opt/gascity/weaver-plus`, and does not use Neon `proud-salad-68182047`.

## What the walkthrough URL is

Success is one line in the deploy log:

```text
preview_url=https://pr-<n>.anakwannaphaschaiyong.com
```

Opening that URL returns HTTP 200 and the page contains `data-dyad-browser-bridge`. `/sign-in` is the walkthrough entry. Clerk already allows origins that match `https://pr-<n>.anakwannaphaschaiyong.com` once `deploy/preview/clerk-origins-run.mjs` runs with the Clerk secret from `forma/dev`.

The names `pr-20`, `pr-38`, `pr-43`, `pr-44`, `pr-46`, and `pr-48` currently return Cloudflare 530. Those origins are down. They are not the Forma URL.

## Deploy path

The pull request that receives the `preview` label contains the app (this repository at `main`) plus the three changes below. A docs-only branch builds an image, then still attaches a Wewebplus-hitl database.

1. **Read `forma/dev` instead of attaching a Neon child.** The job downloads Doppler project `forma`, config `dev`, with `DOPPLER_ADMIN_TOKEN`. That config already has the Clerk keys, `WEWEBPLUS_SECRETS_KEY`, the Cloudflare names, and `WEWEBPLUS_DATABASE_URL` for `ep-gentle-night-b3pf8q4y-pooler`. Inherited `aws.dev` supplies the Bedrock names. The job does not call `controller.mjs attach` and does not call `assign-page`. The OIDC identity used by `preview.yml` can stay on `dyad/preview` for every other pull request.
2. **Migrate on the direct host, then serve.** Drizzle's migrator takes a session advisory lock. The Neon pooler does not keep that lock. Before Compose starts, a one-shot from `src/control_plane/db.ts` runs with the same URL after the host label `ep-gentle-night-b3pf8q4y-pooler` is rewritten to `ep-gentle-night-b3pf8q4y`. The URL is not printed. The check is four rows in `drizzle.__drizzle_migrations` and an empty `wewebplus.questions`. The container then receives the pooled URL from `forma/dev`.
3. **Print the URL even when Gas City is absent.** `preview-up.sh` starts `gascity` and `poller` before it prints `preview_url`, and exits 2 if they fail. This deploy sets `PREVIEW_SKIP_POLLER=1`. The `dyad` service and the named Cloudflare tunnel still start. `https://gc-pr-<n>.anakwannaphaschaiyong.com` is not part of the walkthrough.

`preview-up.sh` already creates `https://pr-<n>.anakwannaphaschaiyong.com` when the Cloudflare token is present, including when `PREVIEW_SKIP_TUNNEL=1`. `PREVIEW_REQUIRE_NAMED_TUNNEL=1` and `PREVIEW_REQUIRE_BEDROCK=1` stay. The production-marker check stays: the Devbox must not contain `/opt/gascity/weaver-plus`.

Compose project `preview-<n>` and its volumes are the only runtime state. Other `preview-*` projects on `Wewebplus-ci` stay up. The Devbox concurrency group still runs one deploy at a time.

## Walkthrough

After the log prints `preview_url`:

1. Open `https://pr-<n>.anakwannaphaschaiyong.com/sign-in`.
2. Sign in with Clerk. The account chip shows the signed-in account.
3. Create or open one project and send one message far enough to see the preview pane update.

That is the Dev walkthrough. Gas City gates, Canary, and Production are later plans.

## Manual now, same path later

Today the operator adds the `preview` label to the Forma pull request and reads `preview_url` from the deploy job. Removing the label runs the existing destroy job for that pull request number only.

Later, CI uses this same job. The label is the Dev deploy button. Canary and the EC2 rollout stay the promotion buttons and are not added here.

## Out of scope

- Bolt, Vibe SDK, and a generalized experiment slot. They reuse this shape later.
- `hitl.py`, the answer closer, and rig `multi tenant HITL`.
- A hostname other than `pr-<n>.anakwannaphaschaiyong.com`.
- Changing Doppler `dyad/prd` or the production container.

## Done when

- [ ] The deploy log contains `preview_url=https://pr-<n>.anakwannaphaschaiyong.com`.
- [ ] That URL returns HTTP 200 and `data-dyad-browser-bridge`.
- [ ] The database host in use is `ep-gentle-night-b3pf8q4y`, and `wewebplus.questions` is empty before the walkthrough.
- [ ] The log does not mention `mute-credit-71067312`, `proud-salad-68182047`, or `ep-young-wave-b3cwe0rz`.
