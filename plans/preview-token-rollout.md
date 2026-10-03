# Replace the preview token and rebuild the Gas City image

> Written 2026-10-03. The Singapore Bedrock chat works on the running container, but that container is still the previous image. The image rebuild stops because `/etc/doppler/dyad-preview.token` is rejected.

## Summary

The committed Bedrock client ignores a saved bearer when IAM env is set. That code is not in the running image. `weaver-plus:gascity` is still `sha256:8a85cc4a5d1d` from `f6f9134c`. The container is healthy because it was recreated with Singapore IAM env and the global model id, and Discovery replied `pong`. A saved bearer on this image would be sent again.

The host wrapper reads `/etc/doppler/dyad-preview.token` before it builds. That file returns `Invalid Auth token`. The roll-up for `21789ebc` failed at that download ([run 37073686042](https://github.com/Awannaphasch2016/dyad/actions/runs/37073686042)) and did not run `compose up`.

A replacement service token for Doppler project `dyad`, config `preview`, was checked on 2026-10-03. The download succeeded. `DOPPLER_PROJECT` is `dyad`, `DOPPLER_CONFIG` is `preview`, and these names are non-empty: `NOVNC_PASSWORD`, `GAS_CITY_HOST_BRIDGE_TOKEN`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `WEWEBPLUS_DATABASE_URL`, `WEWEBPLUS_SECRETS_KEY`. The token was not written to `/etc/doppler/dyad-preview.token`. The probe copies were deleted. The token value is not in this plan.

## Problem

`scripts/gascity/host-wrapper.sh` downloads `dyad`/`preview` with the token file, then `aws`/`dev` with `/etc/doppler/aws-dev.token`, then writes `/run/gascity-rollout.env`. Doppler rejects the preview file, so the wrapper exits before Dagger and before `scripts/gascity/rollout.sh`. The rollback trap in `rollout.sh` never runs. The healthy container stays on the old image.

The last image build that did reach unpack failed with `no space left on device` ([run 37053916207](https://github.com/Awannaphasch2016/dyad/actions/runs/37053916207)) while writing a file under packaged git. Free space then was about 5.6G. It is 5.2G of 29G now. `/var/lib/containerd` is 9.6G, of which overlay snapshots are 8.2G across 178 snapshots. The largest snapshot is 2.9G. Docker reports 2.746GB of build cache, and only 543.9MB of that is marked reclaimable. `rollout.sh` runs `docker image prune -f` after it has already tagged `weaver-plus:gascity-previous` and installed the rollback trap. It does not prune the build cache, and it does not stop when free space is too small. A disk failure after the trap recreates the container from the previous tag.

`weaver-plus:gascity` and `weaver-plus:gascity-previous` are the same image id today (`8a85cc4a5d1d`). Tagging current as previous before the build keeps this healthy image as the rollback target. `weaver-plus:gascity-before-once` (`0ed1ee86f43e`) is a separate 2.88GB image and stays.

## Scope

### In scope

- Add a disk gate to `scripts/gascity/rollout.sh` before `docker tag` and before the rollback trap. Run `docker builder prune -af` and `docker image prune -f`. If `df` then shows less than 8GiB available on `/`, exit 2. That exit does not retag images and does not recreate the container.
- Extend `scripts/gascity/rollout.test.sh` so it checks that the prune commands and the 8GiB refusal are ordered before `docker tag` and before `trap rollback`.
- On the host, replace `/etc/doppler/dyad-preview.token` with the operator-supplied token. Mode 600, root-owned. Do not print the token, do not commit it, and do not copy it into GitHub.
- After that file is in place, run `/usr/local/sbin/gascity-rollout` for the commit that contains the disk gate. The wrapper fast-forwards `/opt/gascity/weaver-plus`, downloads both Doppler configs, and builds.
- Confirm the new container is healthy, its image id is not `8a85cc4a5d1d`, IAM env is still set, the saved model is `global.anthropic.claude-sonnet-4-5-20250929-v1:0`, and the packaged main process contains the IAM-over-bearer client. Send one Discovery message and expect a model reply.

### Out of scope

- Merging to `main`.
- Deleting `weaver-plus:gascity`, `weaver-plus:gascity-previous`, or `weaver-plus:gascity-before-once`.
- `docker compose down -v`, volume prune, or deleting `/opt/gascity/projects`.
- Changing the Bedrock client, the model id, or the `aws`/`dev` token.
- The home composer setup dialog. `isAnyProviderSetup()` still looks at saved provider keys, so the home page can show "You're almost ready to build" while an existing Discovery chat calls Bedrock.
- Recreating calm-pangolin-hum or cozy-lynx-flip.
- The hopping-quokka-buzz preview error `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.

## Design

The token file stays the only copy the host uses. `host-wrapper.sh` already refuses a missing file and already merges the AWS names from `/etc/doppler/aws-dev.token`. No wrapper change is required for the new preview token.

The disk gate belongs in `rollout.sh` so a GitHub-driven roll-up cannot skip it. Order:

1. Require the env file and the non-empty secret names, as today.
2. Fast-forward the checkout, as today.
3. Prune build cache and dangling images.
4. Read available space on `/`. Below 8GiB, print the available space and exit 2.
5. Only then tag `weaver-plus:gascity` as `weaver-plus:gascity-previous`, install the rollback trap, and run `docker compose up --build -d`.

8GiB is the gate because the unpack already failed with about 5.6G free while the old build cache was still on disk. Pruning that cache first is what makes the free-space number meaningful. If the prune cannot reach 8GiB, the roll-up stops while the current container is still serving. Making room by deleting `weaver-plus:gascity-before-once` is not part of this plan.

Install the token only after the disk-gate commit is on the host checkout. The outer wrapper fast-forwards first and downloads Doppler second. A push made while the old token file is still installed advances the checkout and then fails at Doppler, before `compose up`. That is the safe point to replace the file. Replacing it earlier lets that automatic roll-up build without the gate.

The build uses the existing Dagger call and the existing env allowlist. Secret values stay in the root-only env file. They are not Dagger arguments.

## Verification

Before the build, a names-only Doppler download with the installed file must succeed for project `dyad`, config `preview`, and the six required names must be non-empty. Print names and lengths only.

After `ROLLOUT_OK`:

- `docker inspect` shows `healthy`, and the container image id differs from `sha256:8a85cc4a5d1d`.
- The container has `AWS_REGION=ap-southeast-1`, both IAM variables set, and `AWS_BEARER_TOKEN_BEDROCK` unset.
- Saved settings still use `global.anthropic.claude-sonnet-4-5-20250929-v1:0` with no `providerSettings.bedrock.apiKey`.
- The packaged output under `/app/out/dyad-linux-x64` contains the IAM branch (`useIam`) from `get_model_client.ts`.
- One Discovery send on hopping-quokka-buzz (`/chat?id=11&appId=4`) returns a model reply. The main log for that turn has no `AI_APICallError`.
- `weaver-plus:gascity-previous` is `8a85cc4a5d1d`, and `weaver-plus:gascity-before-once` is still `0ed1ee86f43e`.

`scripts/gascity/rollout.test.sh` covers the gate order. It does not call Docker or Doppler.

## Implementation checklist

- [ ] Add the build-cache prune and the 8GiB exit to `rollout.sh` before the previous-image tag and the rollback trap.
- [ ] Assert that order in `rollout.test.sh`.
- [ ] Push the gate. Wait until that commit's Gas City roll-up fails at Doppler and the container is still the current image.
- [ ] Install the preview token at `/etc/doppler/dyad-preview.token`, mode 600, root-owned. Delete every other copy.
- [ ] Run `/usr/local/sbin/gascity-rollout` for that commit.
- [ ] Confirm health, the new image id, IAM env, the packaged `useIam` branch, and one Discovery reply.

## Risks

| Risk                                                       | Likelihood | Impact | Mitigation                                                                                                                                         |
| ---------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The unpack fills the disk again                            | Medium     | High   | Prune build cache first and refuse below 8GiB before tagging. If the build fails later, the rollback trap restores `weaver-plus:gascity-previous`. |
| The token is installed before the disk gate is on the host | Medium     | High   | The checklist installs the token only after the gated commit's Doppler failure.                                                                    |
| The token or a secret value is printed or committed        | Low        | High   | Probe and logs print names only. The token file is mode 600 and is not in git.                                                                     |
| Two roll-ups run at once                                   | Low        | Medium | `gascity-rollout` does not cancel an in-progress run. Start the host wrapper only after the token-failure run has finished.                        |
| Free space stays under 8GiB after the prune                | Medium     | Medium | Stop. Leave the three named images and the volume in place.                                                                                        |

## Decision log

- Swarm planning tools are not available in this session, so this plan is written directly.
- The replacement token is valid for `dyad`/`preview` and contains the six names the env file requires. It is not installed yet.
- The image rebuild is required because the running image predates the empty-`apiKey` IAM path. Env and settings alone cannot keep a later saved bearer from being sent.
- The disk gate is 8GiB after `docker builder prune -af` because the previous unpack failed near 5.6G with the build cache still present.
- `weaver-plus:gascity-before-once` is not a source of free space for this roll-up.
- Product principle: the token stays in the host file Doppler already uses. It is not copied into the repo, the image, or GitHub.
