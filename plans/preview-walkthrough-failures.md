# Fix the three preview walkthrough failures

The walkthrough on `https://pr-34.anakwannaphaschaiyong.com` hit three failures. This plan fixes the code that produces them. The preview container's `main.log` is not on this machine, and GitHub Actions logs were not readable (`gh` returned HTTP 401). The screenshots plus the functions that emit those exact messages are the evidence.

## What failed

1. **sincere-koala-hug had no `package.json`.** Implementation opened the preview. The runner executed `pnpm install`. pnpm printed `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` for `/home/weaver/dyad-apps/sincere-koala-hug`. The same chat rejected `write_file` until the app blueprint is approved, and the only file that landed was `src/pages/Index.tsx`.
2. **busy-iguana-bloom could not restore.** Discovery is an ask chat. Restore of "Fatbud the bkk weed shop" returned "Could not determine a version to restore to for this message."
3. **A red toast said `DyadError: Chat not found`.** The page still showed the transcript. A later lookup used a chat id that was no longer a row.

The blueprint gate stays. It is doing what it is written to do. These fixes make a new app a real project, make Discovery restorable, and stop a chat list from deleting the app the person is looking at.

## 1. An app folder must be a project before preview runs

### Cause

`getApp` calls `ensureProjectFiles` when the folder has no `.git` (`src/ipc/handlers/app_handlers.ts`, the block around the `projectFilesOnThisMachine` check).

`ensureGitRepository` in `src/control_plane/file_sync.ts` creates the directory and runs `gitService.initRepoWithInitialCommit`. It does not copy a template. The existing test `creates a git repository when the app folder does not exist` expects that empty commit.

`choosePackageManagerFromSignal` in `src/ipc/utils/package_manager_selection.ts` returns `pnpm` when the folder has no `package.json` and no lockfile. `buildPnpmInstallAndRunCommand` in `src/ipc/services/app_runtime_service.ts` then runs `pnpm install`. That is the preview error.

`createApp` already copies the scaffold and records `initialCommitHash` (`createFromTemplate`, then `initRepoWithInitialCommit`, then the chat update in `src/ipc/handlers/app_handlers.ts`). The empty-folder path skips both.

### Change

- When `ensureProjectFiles` finds a missing directory, or a directory whose only content is an empty git repo, copy the same template `createApp` uses, then make the initial commit. Leave a directory that already has project files alone, including one that only has `src/pages/Index.tsx`. Do not overwrite those files with the scaffold.
- After that commit, set `initialCommitHash` on every chat for that app whose hash is still null.
- In `getDefaultCommand`, if `package.json` is absent, do not spawn pnpm or npm. Return a preview message: `This app has no package.json, so the preview cannot start.` The preview panel already renders `ERR_PNPM_*` lines; this message should be a normal error entry, not a pnpm stack.

### Tests

- Extend `src/control_plane/file_sync.test.ts`: a missing folder gains `package.json` from the React scaffold and one commit. An existing `pnpm-workspace.yaml` without `package.json` is left as it is.
- Add a unit test beside `package_manager_selection.ts` or `app_runtime_service.test.ts`: no `package.json` does not produce a `pnpm install` command.

## 2. Discovery restore must find the commit the turn already recorded

### Cause

Discovery chats are ask mode (`factoryPhaseChatMode` in `src/lib/factoryPhase.ts`). Ask turns pass `readOnly: true` (`src/ipc/handlers/chat_stream_handlers.ts`, the `isAskMode` branch). Read-only turns skip `commitAllChanges`, so the assistant row's `commitHash` stays null (`src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`, the comment "In read-only and plan mode, skip commits").

The assistant row does store `sourceCommitHash` at the start of the turn (`getCurrentCommitHash` when the placeholder is inserted in `chat_stream_handlers.ts`).

`resolveTargetCommitHash` in `src/ipc/handlers/version_handlers.ts` looks forward for the next assistant's `sourceCommitHash`, then backward only for `commitHash`, then `initialCommitHash`. On the Discovery screen the user message is last, so the forward look finds nothing. The kickoff assistant has `sourceCommitHash` and no `commitHash`, so the backward look skips it. A null `initialCommitHash` then returns the yellow warning from both copies of that string in `restoreToMessage` (about lines 1346 and 1557).

Ask mode should keep skipping file commits. There is nothing to commit. The bug is the lookup.

### Change

- In the backward scan, use the nearest earlier assistant `commitHash`, and if that message has none, its `sourceCommitHash`.
- Keep the forward scan as it is.
- When every hash is still null, return a warning that names the situation: `This message did not change the project files, so there is no version to restore.` Do not create an empty commit for a Discovery reply.

### Tests

- Unit-test `resolveTargetCommitHash` with the Discovery shape: one assistant with `sourceCommitHash` set and `commitHash` null, then the user message, and `initialCommitHash` null. The result is that `sourceCommitHash`.
- A second case with every hash null returns null, and the restore handler test expects the new warning text.

## 3. Listing chats must not delete the open app

### Cause

`getChats` in `src/ipc/handlers/chat_handlers.ts` calls `retainStartedFactoryPhaseChats`, then `deleteAppById` when the remaining chats are not Discovery, Implementation, and Delivery.

`dropUnstartedChats` in `src/ipc/utils/factory_phase_chats.ts` deletes chats `factoryChatIdsToDrop` names. An app that has some phase titles but not all three loses the empty ones, then `hasFactoryPhases` fails, and the whole app is deleted. The page still shows the transcript it already loaded. The next `getChat` throws `new DyadError("Chat not found", DyadErrorKind.NotFound)` (`chat_handlers.ts` around line 209). `showError` prints `error.toString()`, which is `DyadError: Chat not found` (`src/lib/toast.tsx`).

The test `deletes an app whose chats are not the three phase titles` in `src/ipc/handlers/chat_handlers.test.ts` locks in that deletion. That behavior is what the walkthrough hit.

### Change

- Keep dropping chats whose titles are not a factory phase.
- When a phase title is missing, call `insertFactoryPhaseChats` and keep the app. Do not call `deleteAppById` from `getChats`.
- `insertFactoryPhaseChats` must copy `initialCommitHash` from a sibling chat, or from `HEAD`, onto every phase chat it inserts. Today it inserts the three rows with a null hash and relies on `createApp` to fill them later.

### Tests

- Replace `deletes an app whose chats are not the three phase titles`. After `getChats`, the app row remains, the non-phase chat is gone, and Discovery, Implementation, and Delivery all exist.
- A follow-up `getChat` on the phase chat that already had messages still returns that chat.
- `insertFactoryPhaseChats` sets `initialCommitHash` when a sibling chat or `HEAD` has one.

## Out of scope

- Turning off the app-blueprint gate for `write_file`.
- Making Discovery ask mode create a git commit per reply.
- The four-branch preview workflow list, the `preview` label, or Devbox idle shutdown.
- Reading or changing the live preview container. Verification is by unit tests and a later preview walkthrough.

## Verification

```sh
npm test -- src/control_plane/file_sync.test.ts src/ipc/handlers/chat_handlers.test.ts src/ipc/services/app_runtime_service.test.ts
```

Add the `resolveTargetCommitHash` test next to the version handler tests and include that file in the same run.

After the tests pass, a preview walkthrough should show:

- A new app's Implementation preview starts from the scaffold instead of `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.
- Restore on the first Discovery user message forks from the recorded commit instead of the yellow warning.
- Opening the app does not replace the visible chat with `DyadError: Chat not found`.
