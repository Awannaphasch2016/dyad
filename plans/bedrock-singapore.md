# Singapore Bedrock for the Gas City chat

> Written 2026-10-02. The live Discovery chat fails with `AI_APICallError: Forbidden` because the container calls Bedrock with an expired bearer token and a US model id. The AWS account is Singapore.

## Summary

Sending a message on the Wewebplus page creates the app, then the local agent calls Amazon Bedrock. The saved provider is `bedrock`, the saved model is `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, and the saved credential is a bearer token. The container has no `AWS_REGION`, so `src/ipc/utils/get_model_client.ts` uses `us-east-1`. Bedrock answers that request with HTTP 403 and `Bearer Token has expired`. The AI SDK surfaces only `AI_APICallError: Forbidden`.

Doppler project `aws`, config `dev`, has `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION=ap-southeast-1`. Those IAM keys call `global.anthropic.claude-sonnet-4-5-20250929-v1:0` in Singapore and the model replies. The on-demand id `anthropic.claude-sonnet-4-5-20250929-v1:0` is rejected there. `apac.anthropic.claude-sonnet-4-5-20250929-v1:0` is not a profile in this account. `us.anthropic.claude-sonnet-4-5-20250929-v1:0` is the wrong profile for this region.

The fix makes the Gas City container use those three environment variables, stops sending the expired bearer when they are set, and points the saved model at the global inference profile.

## Problem

`createAmazonBedrock` uses bearer authentication whenever `apiKey` is non-empty. It uses SigV4 only when that key is absent. The Gas City settings file stores a plaintext Bedrock bearer token, and `getRegularModelClient` passes that token as `apiKey`. The IAM variables are never read while that token is present.

```897:904:src/ipc/utils/get_model_client.ts
    case "bedrock": {
      const provider = createAmazonBedrock({
        apiKey: apiKey,
        region: getEnvVar("AWS_REGION") || "us-east-1",
        ...getModelClientFetchOption(),
      });
```

`compose.gascity.yml` does not pass `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_REGION`. `scripts/gascity/write_rollout_env.py` allowlists the six `dyad`/`preview` names and drops every other Doppler name. The host token at `/etc/doppler/dyad-preview.token` is project `dyad`, config `preview`. The Singapore keys live in a different Doppler project.

The selected model is stored on the named volume `weaver-plus_weaver-plus-user-data`, in `/home/weaver/.config/weaver-plus/user-settings.json`. Changing the catalog constant alone does not change the model the running chat already saved.

## Scope

### In scope

- Bedrock client: when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, call `createAmazonBedrock` without `apiKey` so the SDK signs with SigV4. Region stays `getEnvVar("AWS_REGION") || "us-east-1"` so a desktop install with only a bearer token keeps today's behavior.
- Gas City compose: pass the three AWS variables into the container. Default `AWS_REGION` to `ap-southeast-1` in `compose.gascity.yml` only.
- Rollout env file: merge a second Doppler download from project `aws`, config `dev`, and allowlist `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`. Keep the existing `dyad`/`preview` allowlist. Do not copy `EC2_SSH_KEY` or write either token into git.
- Host: install the operator-supplied `aws`/`dev` service token at `/etc/doppler/aws-dev.token`, mode 600, root-owned. The wrapper reads it the same way it reads the preview token. Secret values are not arguments to Dagger and are not printed.
- Saved settings on the volume: set the selected Bedrock model name to `global.anthropic.claude-sonnet-4-5-20250929-v1:0` and remove the stored Bedrock bearer token so a process started without the IAM variables cannot keep using the expired token.
- Catalog entry in `src/ipc/shared/language_model_constants.ts`: the builtin Bedrock Claude 4.5 Sonnet id becomes `global.anthropic.claude-sonnet-4-5-20250929-v1:0`, which is the profile this Singapore account can invoke.
- Tests for the client choice and the env allowlist.
- One chat send on the live page after the new container is healthy. The expected result is a model reply. `AI_APICallError: Forbidden` means the fix missed.

### Out of scope

- Hardcoding `ap-southeast-1` inside `get_model_client.ts`.
- Putting AWS keys, the Doppler token, or the old bearer token in the repo, the PR, or the image.
- Replacing the `dyad`/`preview` token or moving Clerk and database secrets into project `aws`.
- OpenRouter, Dyad Pro, or a new Bedrock API key.
- Deleting `weaver-plus:gascity-before-once`.
- Merging to `main`.

## Design

The host wrapper downloads two JSON documents: `dyad`/`preview` with the existing token, and `aws`/`dev` with the new token. `write_rollout_env.py` accepts the preview object and an optional AWS object. It still refuses to write when a preview name is missing. It also refuses to write when any of the three AWS names is missing or empty. The compose file interpolates them. The container process then has `AWS_REGION=ap-southeast-1` and the IAM pair.

`get_model_client.ts` checks those two IAM variables before the stored provider key. If both are set, the Bedrock provider is constructed with `region` and no `apiKey`. The SDK then loads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` and signs the request. If either IAM variable is missing, the current bearer path remains, including the `us-east-1` fallback, so other Bedrock setups do not change.

The volume edit is a one-time settings change, not a migration in git. It rewrites `selectedModel.name` when the current value is `us.anthropic.claude-sonnet-4-5-20250929-v1:0` and provider is `bedrock`, and it deletes `providerSettings.bedrock.apiKey`. It does not print the removed value.

The next roll-up still builds an image. The last build failed while unpacking because the disk filled. Before that build, remove dangling images left by the failed unpack. Leave `weaver-plus:gascity`, `weaver-plus:gascity-previous`, and `weaver-plus:gascity-before-once` in place.

## Verification

A direct `bedrock-runtime` `converse` call with the Doppler IAM keys, region `ap-southeast-1`, and model `global.anthropic.claude-sonnet-4-5-20250929-v1:0` already returned `pong` on 2026-10-02. After the container change, send one message in Discovery on the live tunnel and confirm the page shows a model reply. The main log should not contain `AI_APICallError: Forbidden` for that turn.

Unit coverage:

- `src/ipc/utils/get_model_client.test.ts`: IAM variables present means the Bedrock fetch is SigV4 and the stored bearer is not sent. IAM variables absent means the stored bearer is still sent.
- `scripts/gascity/rollout.test.sh`: the env file contains the three AWS names when the AWS JSON has them, and it exits 2 when one is empty. Preview names and the bridge constants stay as they are.

## Implementation checklist

- [x] Prefer IAM env over the stored Bedrock bearer in `get_model_client.ts`.
- [x] Change the builtin Bedrock Claude 4.5 Sonnet id to `global.anthropic.claude-sonnet-4-5-20250929-v1:0`.
- [x] Pass `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` through compose and `write_rollout_env.py`.
- [x] Download Doppler `aws`/`dev` from `/etc/doppler/aws-dev.token` in the host wrapper.
- [x] Install that token on the host, mode 600, without writing it to git.
- [x] Update the volume settings: global model id, remove the stored bearer.
- [x] Free dangling image space, then roll the container forward.
- [x] Send one live chat message and confirm Bedrock replies.

The `dyad`/`preview` service token on the host now returns `Invalid Auth token`, so the GitHub image rebuild stops before `compose up`. The running container is still the previous image. It was recreated with the Singapore IAM environment and the saved model id `global.anthropic.claude-sonnet-4-5-20250929-v1:0`. A Discovery message on hopping-quokka-buzz returned `pong` at 22:38Z, and the main log recorded token use with no `AI_APICallError`. The next image build needs a valid `dyad`/`preview` token so the new client code, which ignores a saved bearer when IAM env is set, is what the container runs.

## Risks

| Risk                                                  | Likelihood                         | Impact | Mitigation                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The image build fills the disk again                  | Medium                             | High   | Remove dangling images first. Keep the three named Gas City tags. Roll back to `weaver-plus:gascity-previous` if the new container is unhealthy. |
| The saved model id stays on the `us.` profile         | High if the volume edit is skipped | High   | The volume edit is part of the same change as the env vars. The catalog change covers a fresh settings file.                                     |
| A desktop user with only a bearer token loses Bedrock | Low                                | Medium | SigV4 is selected only when both IAM variables are set.                                                                                          |
| The `aws`/`dev` token is missing on the host          | Medium                             | High   | The env writer exits 2 before `compose up`, and the previous container stays up.                                                                 |

## Decision log

- Swarm planning tools are not available in this session, so this plan is written directly.
- Singapore is `ap-southeast-1` because that is the value of `AWS_REGION` in Doppler project `aws`, config `dev`.
- The working model id is the global inference profile. The regional on-demand id and the `apac.` id were both rejected by this account.
- The expired bearer stays out of the request by omitting `apiKey` when IAM env is present. Deleting it from the volume is the backup for a start that lacks those variables.
- AWS keys stay in Doppler project `aws`. They are not copied into `dyad`/`preview` and they are not committed.
