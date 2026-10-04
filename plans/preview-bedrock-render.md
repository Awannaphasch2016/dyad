# Render the Bedrock fix on a preview

> Written 2026-10-04. The IAM client is already in the preview image. The preview page is down, and the preview env file does not get AWS credentials from the Dyad Doppler config.

## Summary

The Forbidden chat error was an expired Bedrock bearer token. The client in `src/ipc/utils/get_model_client.ts` now signs with SigV4 when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, and it does not send a saved bearer. That code is on `cursor/formula-preview-9e7a` at `3f77679d`. GitHub published it as `ghcr.io/awannaphasch2016/dyad@sha256:c345ec8851ae309b02d007ae162f2ce8782b4403f47a920bd53c0369dc00141a`.

Preview 27 started from that image at 09:22Z on Devbox `Wewebplus-ci` and answered HTTP 200 at `https://nearly-private-passed-blink.trycloudflare.com`. That host no longer resolves. `https://pr-27.anakwannaphaschaiyong.com` does not resolve. `https://pr-20.anakwannaphaschaiyong.com` returns HTTP 530. The production container on EC2 is a different, older image and is not the target of this plan.

The preview controller downloads one Doppler token, the GitHub secret `DOPPLER_TOKEN`. That download is enough to attach Neon branch `preview-pr-27`. It is not the AWS config. AWS keys are copied only when they are already in that download or already exported in the Devbox shell. A Dyad `preview` token does not include them. The production host copies them from a second token for project `aws`, config `dev`. The preview path does not.

## Problem

A fresh preview has no saved Bedrock API key. `isProviderSetup` in `src/lib/providerUtils.ts` treats Bedrock as ready only when a saved `apiKey` exists or `AWS_BEARER_TOKEN_BEDROCK` is set. The IAM pair is not one of those. `get-env-vars` sends provider env values to the renderer, and the Bedrock name in that list is `AWS_BEARER_TOKEN_BEDROCK`. The home composer then shows "You're almost ready to build" and does not call the model, so the preview never shows whether Forbidden is gone.

`deploy/preview/render.mjs` allowlists `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`, but `downloadDoppler` reads only `DOPPLER_TOKEN`. `scripts/gascity/preview-up.sh` copies those names from the shell into the Compose env file when they are non-empty. It does not download project `aws`. It also does not rewrite a saved US model id or delete a stored bearer. The production script `scripts/gascity/use_singapore_bedrock_settings.py` does that, and preview startup does not call it.

The public name `https://pr-<n>.anakwannaphaschaiyong.com` is printed only when the named Cloudflare tunnel token is present. The last successful deploy set `PREVIEW_SKIP_TUNNEL=1` and fell through to a quick tunnel. That address dies when the Devbox session stops.

## Scope

### In scope

- Preview 27 on `Wewebplus-ci`, Compose project `preview-27`, image built from a commit that contains `useIam`.
- A second Doppler download, project `aws`, config `dev`, merged into the preview runtime exports. The token is a GitHub secret or the existing Devbox `controller.env`. It is not committed and not printed.
- Startup refuses to call the deploy successful for this check until the container process has all three AWS names set. Log `bedrock_iam=present` or `bedrock_iam=absent`. Do not log the values.
- After the container is healthy, run `use_singapore_bedrock_settings.py` against that preview's settings file so a saved US Sonnet id becomes `global.anthropic.claude-sonnet-4-5-20250929-v1:0` and a stored Bedrock `apiKey` is removed.
- Tell the home composer that Bedrock is configured when IAM is present, without sending the access key or the secret to the renderer.
- One signed-in chat on the URL printed by that deploy. The expected reply is a model answer. `AI_APICallError: Forbidden` means the env or the image is still wrong.

### Out of scope

- The production EC2, `gascity-rollout.yml`, `/etc/doppler/dyad-preview.token`, and `/opt/gascity`.
- Replacing the GitHub `DOPPLER_TOKEN` that already attached Neon.
- Using the rejected service token from the previous chat. Doppler returned `Invalid Auth token` for it, and its slug is `preview`, not `aws`/`dev`.
- Merging to `main`, closing pull requests 17 through 24, or deleting `weaver-plus:gascity-before-once`.
- Teaching the named host `pr-27` to resolve. The check uses the `preview_url` line from the deploy log. A stable name is a later Cloudflare credential change.

## Design

`controller.mjs` keeps the current Dyad download. When `AWS_DOPPLER_TOKEN` is set, it downloads that token and, only if the first download lacks a non-empty value, fills `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`. `previewRuntime` already exports those names. `preview-up.sh` already upserts them into `preview-27.env`.

The GitHub workflow that deploys this branch passes `AWS_DOPPLER_TOKEN` into `controller.mjs` the same way it passes `DOPPLER_TOKEN`. The Devbox re-reads `controller.env` before `preview-up.sh`. If that file already exports the three names, they still reach the container. The new download covers the case where it does not.

`get-env-vars` adds one non-secret flag, `BEDROCK_IAM=1`, when both IAM variables are non-empty in the main process. It does not add `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` to the renderer map. `isProviderSetup("bedrock")` returns true when that flag is set, and it still returns true for a saved key or `AWS_BEARER_TOKEN_BEDROCK`.

`preview-up.sh`, after `dyad` is healthy, runs `use_singapore_bedrock_settings.py` inside the preview container. The script prints `bedrock settings updated` and not the removed key.

The image has to be rebuilt after the setup-flag change. `useIam` is already in `3f77679d`, but that digest does not contain the flag. Pushing the flag to `cursor/formula-preview-9e7a` runs `.github/workflows/preview-image.yml`, which publishes `ghcr.io/awannaphasch2016/dyad:sha-<commit>` and updates preview 27. This plan file stays on its own branch so writing the plan does not start that build and does not start `gascity-rollout.yml`.

## User flow

1. The deploy log prints `preview_url=https://...`.
2. Open that URL and sign in. The home composer accepts a prompt because Bedrock IAM counts as configured.
3. Send "Reply with the single word pong."
4. The page shows `pong`. It does not show `AI_APICallError: Forbidden`.

The quick tunnel is valid only while that Devbox session is up. If the host no longer resolves, rerun the deploy and use the new `preview_url`.

## Verification

- `src/lib/providerUtils` test: `BEDROCK_IAM=1` with no saved key and no bearer reports Bedrock set up. Absent flag and absent key reports it not set up.
- Preview controller test: a Dyad download without AWS names plus an AWS download with the three names exports all three. The test fixtures are fake values. The test asserts the real token strings are absent.
- `preview-up.sh` test, or the existing preview script test: the healthy path invokes `use_singapore_bedrock_settings.py`.
- On the live preview, `docker exec` prints `bedrock_iam=present`, the image id is the new digest, and a strings search of `/app/out/dyad-linux-x64` finds `useIam`. Then one chat returns `pong`.

## Implementation checklist

- [ ] Add `BEDROCK_IAM` to `get-env-vars` and to `isProviderSetup("bedrock")`.
- [ ] Download `aws`/`dev` in `controller.mjs` when `AWS_DOPPLER_TOKEN` is set, and export only the three AWS names.
- [ ] Pass that secret through the preview image workflow without printing it.
- [ ] Run the Singapore settings script after the preview container is healthy.
- [ ] Fail the Bedrock check when any of the three names is empty, and print `bedrock_iam=absent`.
- [ ] Merge those commits onto `cursor/formula-preview-9e7a` so preview 27 rebuilds.
- [ ] Open the `preview_url` from that run, sign in, and confirm one chat replies `pong`.

## Risks

| Risk                                                        | Likelihood | Impact | Mitigation                                                                                                    |
| ----------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| The AWS token is missing or rejected                        | High       | High   | The deploy prints `bedrock_iam=absent` and the chat check does not start. The Dyad Neon token stays as it is. |
| The quick tunnel dies before the chat                       | High       | Medium | Read `preview_url` from the same run and send the message while the Devbox session is up.                     |
| The home composer still blocks the call                     | Medium     | High   | The `BEDROCK_IAM` flag is in the image that this deploy builds.                                               |
| A stored bearer on the preview volume overrides SigV4       | Low        | High   | The settings script removes it before the chat. The client also forces an empty `apiKey` when IAM is set.     |
| A push to `cursor/browser-dyad-ui-bbea` rebuilds production | Medium     | High   | This plan is not on that branch. Implementation merges into `cursor/formula-preview-9e7a`.                    |

## Decision log

- Swarm planning tools are not available in this session, so this plan is written directly.
- Preview 27 is the preview to update. Its last image already contains `useIam`. Its public URL is gone.
- Production EC2 stays on image `sha256:8a85cc4a5d1d`. That container already answered `pong` with injected IAM env, and it does not contain `useIam`.
- AWS credentials are a second Doppler download, project `aws`, config `dev`. They are not inherited from the Dyad `preview` config.
- The renderer learns that IAM is configured through `BEDROCK_IAM=1`. The key and the secret stay in the main process.
- The page to open is the `preview_url` printed by the preview deploy, not the production quick tunnel and not `pr-20`.
