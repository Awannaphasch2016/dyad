# Remove the stale Bedrock bearer from settings

> Written 2026-10-04. Scope is the saved bearer only. Doppler OIDC, service tokens, dynamic secrets, and the EC2 instance role are a different plan.

## Outcome

Bedrock requires `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. A missing pair fails before any request. A saved Bedrock API key is deleted on read and on write, and the settings page has no paste box. Chats sign with SigV4. If a bearer is ever sent and AWS says it expired, the chat shows `Bearer Token has expired`.

## Where the string is

The expired value is `providerSettings.bedrock.apiKey` in the user-data file `user-settings.json`. `userData/` is gitignored. Settings → AWS Bedrock pasted it there. `AWS_BEARER_TOKEN_BEDROCK` is the same string as an environment variable. The preview Doppler config does not have that name, and the production container does not have it set.

`src/ipc/utils/get_model_client.ts` already passes `apiKey: ""` when both IAM variables are set, and the test `bedrock IAM env signs with SigV4 and does not send the stored bearer` covers that request. `scripts/gascity/use_singapore_bedrock_settings.py` deletes the key only when preview startup or a rollout runs it. `ProviderSettingsPage` `handleSaveKey` can write the key again after that.

The production image does not contain `useIam`. A bearer saved on that image is sent as `Authorization: Bearer`. This plan changes the source. It does not rebuild that image.

## In scope

1. `writeSettings` drops `providerSettings.bedrock.apiKey` before the file is written, whether or not the IAM pair is set. An empty `bedrock` object is removed with it.
2. `readSettings` drops a key already in the file, writes the file back once, and logs `removed stored bedrock bearer` without the value.
3. The Bedrock settings page never renders the paste box. With `BEDROCK_IAM=1` it says requests are signed with the AWS credentials on the server. Without that flag it says the IAM pair is required.
4. `getModelClient` throws `Bedrock requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.` before any network call when either value is missing. It always passes an empty `apiKey`, so `AWS_BEARER_TOKEN_BEDROCK` is not sent.
5. `isProviderSetup("bedrock")` is true only when `BEDROCK_IAM` is `1`. `get-env-vars` does not copy `AWS_BEARER_TOKEN_BEDROCK` to the renderer.
6. `getErrorMessageWithDetails` appends a response body that contains `Bearer Token has expired`. Other response bodies stay hidden.

## Out of scope

- The Doppler identity plan in `plans/doppler-workload-identity.md`. No OIDC, no service-token replacement, no inheritance change.
- Rebuilding the production image, replacing `/etc/doppler` token files, or pruning disk.
- Pushing this branch onto `cursor/preview-bedrock-render-bbea` or `cursor/browser-dyad-ui-bbea`. Those pushes start a preview image build or a production rollout.
- Minting IAM users, access keys, or Bedrock API keys.
- Merging to `main`.

## Verification

- `writeSettings` with both IAM variables set and `apiKey` value `expired-bearer` leaves the file without that key.
- `readSettings` on a file that already contains `expired-bearer`, with both IAM variables set, returns settings without the key and rewrites the file. A second read does not write.
- With the IAM pair empty, a saved bedrock key is still removed, and `getModelClient` throws before a request.
- `BEDROCK_IAM=1` renders the status line and does not render the paste control.
- A body containing `Bearer Token has expired` is included in the chat error. A body that is only `Forbidden` is not.
- The existing SigV4 test stays green.

Test values are the literal `expired-bearer`. No real bearer is printed or committed.

## Checklist

- [x] Strip the key in `writeSettings`.
- [x] Strip and rewrite once in `readSettings`. Log `removed stored bedrock bearer`.
- [x] Hide the Bedrock paste box. Require the IAM pair, and fail before a request when it is missing.
- [x] Surface `Bearer Token has expired`.
- [x] Add the tests above.

## After this lands

The preview image that contains these edits deletes a stored bearer on startup and refuses a Bedrock call that has no IAM pair. The production container keeps its current image until a separate rollout is approved. On that image, saving a Bedrock API key in Settings sends the bearer again.
