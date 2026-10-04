# Stop a stored Bedrock bearer from staying in settings

> Written 2026-10-04. The expired bearer is not in git. It was pasted into Settings and saved in `user-settings.json`. This plan removes that string whenever the IAM pair is present, and it shows the expiry text if a bearer is ever sent.

## Summary

The Forbidden chat was `Authorization: Bearer` plus a Bedrock API key that AWS had already expired. That string lives in `providerSettings.bedrock.apiKey` inside the user-data file `user-settings.json`. `userData/` is gitignored. The preview client in `src/ipc/utils/get_model_client.ts` already signs with SigV4 when `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are both set, and the request test proves the stored string is not placed on `Authorization`.

The string can still sit in the file. `scripts/gascity/use_singapore_bedrock_settings.py` deletes it only when preview startup or a production rollout runs the script. After that, Settings → AWS Bedrock still has a paste box. `ProviderSettingsPage` `handleSaveKey` writes `providerSettings.bedrock.apiKey` again. The next chat ignores it while the IAM pair is in the process environment. The chat after the pair is missing sends it, and `getErrorMessageWithDetails` still drops the body `Bearer Token has expired`.

## Problem

`set-user-settings` calls `writeSettings` with whatever the page submitted. Nothing in that path looks at the IAM pair. `readSettings` returns the file as stored. A bearer pasted once therefore survives container restarts until an external script rewrites the file.

`get_model_client.test.ts` keeps the fallback: with the IAM pair empty, the client sends `Bearer` and the saved value. That fallback is correct for a desktop install that only has a Bedrock API key. It is the path that reused the expired key on the production image, which does not contain `useIam`.

`getErrorMessageWithDetails` appends `responseBody` only when the body contains a free-model quota marker. A Bedrock 403 body is `{"Message":"Bearer Token has expired"}`. The page shows `AI_APICallError: Forbidden`.

`AWS_BEARER_TOKEN_BEDROCK` is the env-var name for the same pasted string. The current preview Doppler download does not contain it. Passing `apiKey: ""` makes `@ai-sdk/amazon-bedrock` `loadOptionalSetting` keep that empty string and skip the env var, so an env bearer would also stay unused while the IAM pair is set. The file on disk is the copy that rots.

## Scope

### In scope

- When both IAM variables are non-empty, `writeSettings` drops `providerSettings.bedrock.apiKey` before the file is written.
- When both are non-empty, `readSettings` drops a key that is already in the file and writes the file back once. The log line is `removed stored bedrock bearer` and does not include the value.
- The Bedrock settings page, when `BEDROCK_IAM` is `1`, shows that requests are signed with the AWS credentials already on the server. It does not show the paste box.
- A chat error whose response body contains `Bearer Token has expired` includes that sentence. Other response bodies stay hidden.

### Out of scope

- Rebuilding the production image on EC2, replacing `/etc/doppler` tokens, or pruning Docker disk.
- Pushing this branch onto `cursor/preview-bedrock-render-bbea` or `cursor/browser-dyad-ui-bbea`. Those pushes start a preview image build or a production rollout.
- Minting IAM users, access keys, or Bedrock API keys.
- Removing the no-IAM fallback that sends a saved bearer. Desktop installs without the IAM pair keep that path.
- Merging to `main`.

## Design

`writeSettings` in `src/main/settings.ts` is the single save used by `set-user-settings`. Before it merges and writes, if `process.env.AWS_ACCESS_KEY_ID` and `process.env.AWS_SECRET_ACCESS_KEY` are both non-empty after trim, delete `providerSettings.bedrock.apiKey`. If the bedrock object is then empty, delete `providerSettings.bedrock`. A paste during the session never lands in the file.

`readSettings` does the same check after it parses the file. If it removed a key, it writes the file back through the existing atomic write and logs `removed stored bedrock bearer`. Later reads see a file that no longer has the string, including after a restart that happens before `use_singapore_bedrock_settings.py`.

The renderer already receives `BEDROCK_IAM=1` from `get-env-vars` and never receives the access key or the secret. `ProviderSettingsPage` reads that flag from `useSettings().envVars`. For provider `bedrock` with the flag set, the page renders one status line and skips `ApiKeyConfiguration`. Delete and paste handlers are not offered.

`getErrorMessageWithDetails` gains one marker, `Bearer Token has expired`, next to the free-quota markers. The Bedrock body for that case does not contain the bearer. Arbitrary 403 bodies stay omitted.

The preview startup script stays. It still rewrites a US Sonnet id to the global profile. The settings read and write above are what stop a later paste from putting the bearer back.

## User flow

1. Open Settings → AWS Bedrock on a preview whose process has the IAM pair.
2. The page says requests are signed with the AWS credentials on the server. There is no API key field.
3. Send a chat. The request is SigV4. The settings file has no `providerSettings.bedrock.apiKey`.
4. If a bearer is ever sent and AWS rejects it, the chat shows `Bearer Token has expired` in the error text.

## Verification

- Settings unit test: `writeSettings` with both IAM env vars set and a bedrock `apiKey` leaves the file without that key. The test value is the literal `expired-bearer`.
- Settings unit test: `readSettings` on a file that already contains `expired-bearer`, with both IAM env vars set, returns settings without the key and rewrites the file. A second read does not write again.
- Settings unit test: with the IAM pair empty, a saved bedrock key is still returned.
- Provider settings test: `BEDROCK_IAM=1` renders the status line and does not render the paste control.
- `getErrorMessageWithDetails` test: a body containing `Bearer Token has expired` is included. A body that is only `Forbidden` is not.
- Existing test `bedrock IAM env signs with SigV4 and does not send the stored bearer` stays green.

## Implementation checklist

- [ ] Strip `providerSettings.bedrock.apiKey` inside `writeSettings` when both IAM env vars are set.
- [ ] Strip and rewrite once inside `readSettings` when the file still has that key and both IAM env vars are set. Log `removed stored bedrock bearer`.
- [ ] Hide the Bedrock paste box when `BEDROCK_IAM` is `1`.
- [ ] Surface `Bearer Token has expired` from `getErrorMessageWithDetails`.
- [ ] Add the tests above. Do not print or commit a real bearer.

## Risks

`readSettings` runs on many IPC calls. The rewrite happens only when the key is present, so a steady state does not rewrite the file on every chat.

A desktop user who exports the IAM pair and also wants a saved bearer will have that bearer removed. Gas City and the preview are the installs that export the pair. The no-IAM fallback remains for everyone else.

This branch does not change the running production container. The production image still sends a saved bearer. Applying the same behavior there is a later rollout, after a valid host Doppler token and a disk check.
