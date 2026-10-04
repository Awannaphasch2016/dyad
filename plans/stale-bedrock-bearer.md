# Remove the stale Bedrock bearer from settings

> Written 2026-10-04. Scope is the saved bearer only. Doppler OIDC, service tokens, dynamic secrets, and the EC2 instance role are a different plan.

## Outcome

A Bedrock API key saved in `user-settings.json` is deleted when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, and a later paste cannot write it back. Chats sign with SigV4. If a bearer is ever sent and AWS says it expired, the chat shows `Bearer Token has expired`.

## Where the string is

The expired value is `providerSettings.bedrock.apiKey` in the user-data file `user-settings.json`. `userData/` is gitignored. Settings → AWS Bedrock pasted it there. `AWS_BEARER_TOKEN_BEDROCK` is the same string as an environment variable. The preview Doppler config does not have that name, and the production container does not have it set.

`src/ipc/utils/get_model_client.ts` already passes `apiKey: ""` when both IAM variables are set, and the test `bedrock IAM env signs with SigV4 and does not send the stored bearer` covers that request. `scripts/gascity/use_singapore_bedrock_settings.py` deletes the key only when preview startup or a rollout runs it. `ProviderSettingsPage` `handleSaveKey` can write the key again after that.

The production image does not contain `useIam`. A bearer saved on that image is sent as `Authorization: Bearer`. This plan changes the source. It does not rebuild that image.

## In scope

Four edits, all behind the same condition: both IAM variables are non-empty after trim.

1. `writeSettings` in `src/main/settings.ts` drops `providerSettings.bedrock.apiKey` before the file is written. An empty `bedrock` object is removed with it. `set-user-settings` uses this function, so a paste during the session does not land.
2. `readSettings` drops a key already in the file, writes the file back once through the existing atomic write, and logs `removed stored bedrock bearer` without the value. A second read does not write.
3. `ProviderSettingsPage`, when `useSettings().envVars.BEDROCK_IAM` is `1`, shows that requests are signed with the AWS credentials on the server and does not render the paste box. The renderer already receives that flag from `get-env-vars` and does not receive the access key or the secret.
4. `getErrorMessageWithDetails` appends a response body that contains `Bearer Token has expired`. Other response bodies stay hidden. That body does not contain the bearer.

Desktop installs with the IAM pair empty keep the current path: a saved bearer is still sent. The existing test `bedrock without IAM env still sends the stored bearer token` stays.

## Out of scope

- The Doppler identity plan in `plans/doppler-workload-identity.md`. No OIDC, no service-token replacement, no inheritance change.
- Rebuilding the production image, replacing `/etc/doppler` token files, or pruning disk.
- Pushing this branch onto `cursor/preview-bedrock-render-bbea` or `cursor/browser-dyad-ui-bbea`. Those pushes start a preview image build or a production rollout.
- Minting IAM users, access keys, or Bedrock API keys.
- Merging to `main`.

## Verification

- `writeSettings` with both IAM variables set and `apiKey` value `expired-bearer` leaves the file without that key.
- `readSettings` on a file that already contains `expired-bearer`, with both IAM variables set, returns settings without the key and rewrites the file. A second read does not write.
- With the IAM pair empty, a saved bedrock key is still returned.
- `BEDROCK_IAM=1` renders the status line and does not render the paste control.
- A body containing `Bearer Token has expired` is included in the chat error. A body that is only `Forbidden` is not.
- The existing SigV4 test stays green.

Test values are the literal `expired-bearer`. No real bearer is printed or committed.

## Checklist

- [x] Strip the key in `writeSettings`.
- [x] Strip and rewrite once in `readSettings`. Log `removed stored bedrock bearer`.
- [x] Hide the Bedrock paste box when `BEDROCK_IAM` is `1`.
- [x] Surface `Bearer Token has expired`.
- [x] Add the tests above.

## After this lands

The preview image that contains these edits deletes a stored bearer on startup and ignores a paste. The production container keeps its current image until a separate rollout is approved. On that image, saving a Bedrock API key in Settings sends the bearer again.
