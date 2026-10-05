# Require the Gas City hostname and fail closed

> Written 2026-10-04. This is a plan. It does not change the Devbox, Vercel, Doppler, or production.

## Summary

`https://gc-pr-<n>.anakwannaphaschaiyong.com` is the public door from the Vercel page to the preview listener. Doppler project `dyad`, config `preview`, already holds the Cloudflare API token, but that name is dropped before anything is written to `controller.env`, so the hostname is never created. The page then calls its own `/v1`, which returns HTTP 202 and stops. This plan puts the Cloudflare names into `controller.env`, refuses an empty `NEXT_PUBLIC_GAS_CITY_URL`, and deletes that `/v1` fallback.

## Problem

A prompt has two doors today.

| Door                                          | What it does                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `https://pr-<n>.anakwannaphaschaiyong.com`    | Dyad on port 8373. This name already resolves.                                           |
| `https://gc-pr-<n>.anakwannaphaschaiyong.com` | The listener on port 8787. This name is not created when the Cloudflare token is absent. |
| Vercel origin `/v1`                           | Returns HTTP 202 and does not write a question, call Dyad, or start an agent.            |

`deploy/preview/render.mjs` exports seven runtime names from the Doppler download. `CLOUDFLARE_API_TOKEN_`, `CLOUDFLARE_ZONE_ID_`, and `CLOUDFLARE_ACCOUNT_ID` are not among them, so they never reach the Devbox. `~/.local/state/wewebplus-preview/controller.env` is what `preview-up.sh` sources. The sealed install writes that file only when it is missing, and the current file has no Cloudflare token. Both preview workflows also pass `PREVIEW_SKIP_TUNNEL=1`. `scripts/gascity/preview-up.sh` skips `preview-tunnel.mjs` when that flag is set and the token is empty. `scripts/gascity/preview-tunnel.mjs` already has the ingress rule and the DNS write for `gc-pr-<n>` once all three names are present.

`assignPreviewVariable` already rejects an empty value, but `attach` still returns success when `VERCEL_TOKEN` or the git branch is missing. The page is then built without `NEXT_PUBLIC_GAS_CITY_URL` and uses the same-origin `/v1` stand-in. `hitl-web` on this branch has no such route; the stand-in is the behavior recorded for the pull request 16 page. The listener has the same shape of hole: `POST /v1/runs` returns 202 when `continueRun` is not configured, and it still returns 202 when Dyad answers 404.

## Scope

### In scope

- Copy the Cloudflare names from the Doppler `dyad` / `preview` download into the existing Devbox `controller.env`. Merge by name. Mode 600. Do not replace the rest of the file.
- Accept the stored names and the aliases `preview-up.sh` already understands: `CLOUDFLARE_API_TOKEN` for `CLOUDFLARE_API_TOKEN_`, `CLOUDFLARE_ZONE_ID` for `CLOUDFLARE_ZONE_ID_`, and `CLOUDFLARE_ACCOUNT_ID_` for `CLOUDFLARE_ACCOUNT_ID`. Write the names `preview-tunnel.mjs` reads.
- Fail the preview job when any of those three names is empty. Do not skip tunnel creation.
- Require a non-empty `NEXT_PUBLIC_GAS_CITY_URL` for the preview git branch. `attach` fails when the assignment does not happen.
- Delete the same-origin `/v1` fallback. A prompt is sent only to `${NEXT_PUBLIC_GAS_CITY_URL}/v1/runs`.
- Make the listener return an error when it did not write the gate or Dyad did not accept the run. HTTP 202 means the run was accepted.

### Out of scope

- The production host `13.251.216.187`, `/opt/gascity`, `/etc/doppler`, `gascity-rollout.yml`, and Compose project `weaver-plus`.
- Closing pull request 20. Closing it deletes preview 20.
- Printing secret values, committing `controller.env`, or resealing secrets into git.
- A second Vercel project.
- Teaching the `gc` binary to speak `/v1`. The listener remains the browser origin.
- Creating app 1 in preview 20. A missing app must surface as Dyad's 404, not as a new app created by this plan.

## Design

### Cloudflare names

The GitHub job already downloads Doppler with `DOPPLER_TOKEN`. `previewRuntime` gains the three Cloudflare names on its allowlist and keeps refusing every other name, including `NEON_API_KEY` and `EC2_SSH_KEY`. The remote script on `Wewebplus-ci` upserts those names into `controller.env` after sourcing it. The upsert prints `present` or `absent` for each name and never prints a value. `set -x` stays off while the file is sourced.

`PREVIEW_SKIP_TUNNEL=1` no longer means "continue without a hostname." For a preview update, missing credentials exit non-zero before `docker compose up`. When the credentials are present, `ensurePreviewTunnel` updates the existing `preview-pr-<n>` tunnel in place and writes both CNAMEs. Preview 20 is updated, not destroyed.

If Doppler has the API token and not the zone id or account id, the job stops and names the missing key. Those two ids are not read from the production host.

### The page

`NEXT_PUBLIC_GAS_CITY_URL` is required for a preview deployment of the question page. `controller.mjs attach` treats a missing `VERCEL_TOKEN`, a missing git branch, or a failed assignment as a failure. The logged line stays the one that prints the origin and the git branch, never a secret.

The page posts a prompt only to the absolute Gas City origin. There is no relative `/v1` request. If the variable is empty, the prompt action throws before `fetch` and the screen says the preview listener is not configured. `next build` for a preview that includes the prompt action fails when the variable is empty.

Production `main` does not get this variable. Its board remains `/api/questions` against Supabase. The production build does not grow a `/v1` route, and it does not fail for lack of `NEXT_PUBLIC_GAS_CITY_URL`.

### The listener

`POST /v1/runs` on the listener stays. It is the real door. These results stop being HTTP 202:

- No database writer is configured.
- The question insert throws.
- `WEAVER_BASE_URL` or the bridge token is missing.
- Dyad returns a non-2xx status, including 404 because preview 20 has no app 1.

The response is 503 with `Question store is unavailable.` for a local failure, and Dyad's status when Dyad answered. The open `plan-approve` row remains when the insert succeeded, so the board can show the prompt. The log line records the Dyad status. `electronInvoked` stays false. `POST /v1/capabilities/electron` still returns 409 and does not call Electron.

## Implementation

- [x] Add the three Cloudflare names to `runtimeKeys` in `deploy/preview/render.mjs`. Map the unsuffixed Doppler aliases onto the names the tunnel reads before export.
- [x] Upsert those exports into `~/.local/state/wewebplus-preview/controller.env` from the Devbox remote script. Leave every other line in that file alone.
- [x] In `scripts/gascity/preview-up.sh`, exit 2 when any of the three names is empty, including when `PREVIEW_SKIP_TUNNEL=1`.
- [x] Make `attach` in `deploy/preview/controller.mjs` throw when the Vercel assignment or the redeploy cannot be done. Do not log success and continue.
- [x] Find the same-origin `/v1` client. It is not in `hitl-web` on this branch. Delete it, and do not add `hitl-web/app/api/v1` or `hitl-web/app/v1`. The prompt call uses `NEXT_PUBLIC_GAS_CITY_URL` only.
- [x] In `services/gascity-browser/server.mjs`, return an error instead of 202 when `continueRun` is missing or Dyad does not accept the run.
- [x] Update `scripts/gascity/preview-controller.test.mjs`, `scripts/gascity/preview-tunnel.test.mjs`, and `services/gascity-browser/server.test.mjs` for the new refusals.

## Verification

Unit tests cover the allowlist, the hard exit when the token is absent, the refused empty Vercel assignment, and the listener's non-202 failure. They do not call Doppler or Cloudflare.

After that code is on the preview workflow, one labeled update of preview 20 is the live check:

- `controller.env` key names include `CLOUDFLARE_API_TOKEN_`, `CLOUDFLARE_ZONE_ID_`, and `CLOUDFLARE_ACCOUNT_ID`. The check prints names only.
- `https://gc-pr-20.anakwannaphaschaiyong.com` resolves, and `POST /v1/runs` from outside the Docker network reaches the listener.
- The Vercel preview for that git branch has a non-empty `NEXT_PUBLIC_GAS_CITY_URL` on target `preview` only. Production is not written.
- A prompt from that page is logged by the preview listener. The page does not call its own `/v1`.
- With no app 1, the caller sees the failure. It does not see HTTP 202.
- `https://pr-20.anakwannaphaschaiyong.com` still returns HTTP 200. Pull request 20 stays open. The production host is not contacted.

## Risks

| Risk                                                                 | Mitigation                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The Doppler config has the API token and not the zone or account id. | The job names the missing key and stops. It does not read production.                                                         |
| Rewriting `controller.env` drops the Neon or Clerk lines.            | Upsert the three names. Do not rewrite the file.                                                                              |
| A preview build of `hitl-web` on `main` starts failing.              | Only a preview git branch is required to have the variable. Production `main` stays on `/api/questions`.                      |
| Preview 20's existing tunnel is replaced and `pr-20` goes down.      | `ensurePreviewTunnel` updates the tunnel named `preview-pr-20` and writes both hostnames. The job does not delete the tunnel. |

## Decision log

- The second hostname stays. `pr-<n>` belongs to Dyad. `gc-pr-<n>` belongs to the listener. One Cloudflare hostname is one service.
- An empty `NEXT_PUBLIC_GAS_CITY_URL` is a failed preview, not a cue to call `/v1` on Vercel.
- HTTP 202 is only "Dyad accepted the run." The old 202 that meant "we stopped on purpose" is removed.
- Secret values stay in Doppler and in `controller.env` on the Devbox. This plan does not record them.
