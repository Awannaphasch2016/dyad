# Keep a canary app when the phone socket drops

> Plan for the Discovery page that shows a reply and then toasts "Chat not found" and "App not found".

## Summary

Creating an app on https://pre.anakwannaphaschaiyong.com inserts the app and its three phase chats into sqlite. The page then sends `first-prompt:commit-creation` to keep that app. The browser bridge accepts the send and does not call the handler, so the app stays temporary. When the phone's socket closes, the bridge deletes the app and the chats cascade with it. The open page still shows the Discovery reply from memory. The next proposal and branch lookups miss the rows.

## Problem

`dispatchBrowserSend` in `src/main/browser_bridge.ts` checks that the channel is allowlisted and returns. Desktop `ipcRenderer.send` reaches `ipcMain.on`. The bridge path does not.

`createApp` registers a cleanup that deletes the new app. `firstPromptCreationRegistry.commit` is what disarms that cleanup. The commit travels on `first-prompt:commit-creation`, a one-way send. On the bridge it never arrives. `BridgeSender` emits `destroyed` when the last socket closes, and the registry then runs the cleanup.

`deleteAppById` removes the app row. The chat rows cascade. `useProposal` then throws "Chat not found". `useCurrentBranch` throws "App not found".

## Scope

### In scope

- Deliver `first-prompt:commit-creation` and `first-prompt:cancel-creation` from the bridge to the same registry the desktop handlers call.
- Parse those payloads with the existing zod schemas. Drop an invalid payload without deleting or keeping an app.
- After a successful commit, a later socket close leaves the app and its chats in sqlite.
- An explicit cancel, and a socket close before commit, still deletes the unfinished app.
- A bridge test that commits through a socket message, closes the socket, and shows the cleanup did not run. A second test that closes the socket with no commit and shows the cleanup did run.

### Out of scope

- `preview-view:set-bounds` and `preview-view:set-overlay-active`. Those move a desktop `WebContentsView`. The bridge keeps ignoring them.
- Neon, the model key, the preview hostname, and the control-plane database. Those do not own the sqlite rows.
- Changing when the first prompt commits. Commit stays at prompt submit, before the model reply finishes.

## Fix

1. Register the two first-prompt sends the way invoke handlers are registered for the bridge: the desktop path still goes through `ipcMain.on` and `assertTrustedRenderer`. The bridge calls the raw handler with `BridgeSender`, because that sender has no renderer frame and would fail the desktop trust check.
2. `dispatchBrowserSend` looks up that raw handler and calls it with the bridge event and the payload. A send with no raw handler, including the preview-view channels, stays a no-op after the allowlist check.
3. Do not emit `destroyed` for a commit that has already been recorded. That behavior already exists in `FirstPromptCreationRegistry.commit`. The missing piece is delivering the commit.

## Verify on pre

1. Create a new app, send one prompt, and wait until the Discovery reply is visible.
2. Leave the page until the socket drops, then open it again.
3. The same Discovery chat and reply are still there, with no "Chat not found" and no "App not found".
4. Refresh once. The reply is still there.
5. The preview iframe address is still `https://p<port>.anakwannaphaschaiyong.com/`.
