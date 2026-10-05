# Fix the three preview walkthrough failures

The walkthrough on `https://pr-34.anakwannaphaschaiyong.com` hit three failures. The preview container log is not on this machine. The screenshots and the functions below are the evidence.

The blueprint gate stays. A missing project fails immediately. An app workspace is created only as Discovery, Implementation, and Delivery. Restore targets a message.

## 1. Do not create an empty git folder

`getApp` calls `ensureProjectFiles` when the folder has no `.git` (`src/ipc/handlers/app_handlers.ts`). `ensureGitRepository` in `src/control_plane/file_sync.ts` then creates the directory and commits it empty. The preview runs `pnpm install` anyway, because `choosePackageManagerFromSignal` returns `pnpm` when there is no `package.json` (`src/ipc/utils/package_manager_selection.ts`). That prints `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.

`createApp` is the path that makes a project: `createFromTemplate`, then `initRepoWithInitialCommit`, then the `initialCommitHash` update.

`ensureProjectFiles` may still clone when the app row has `githubOrg`, `githubRepo`, and a token. That clone is a real project. It is not the empty-folder fallback.

### Change

- Delete `ensureGitRepository`. If the folder is missing and there is nothing to clone, throw `DyadError` kind `Precondition`: the project files are missing. Do not create a directory and do not run `git init`.
- Remove the `catch` in `getApp` that logs `Could not prepare files` and continues. The error reaches the UI.
- `getDefaultCommand` does not spawn pnpm or npm when `package.json` is absent. The preview says `This app has no package.json, so the preview cannot start.`

### Tests

- Replace `creates a git repository when the app folder does not exist`. A missing folder with no GitHub repo throws, and the directory is not created.
- A folder that already has `.git` stays on its current commit.
- No `package.json` does not produce a `pnpm install` command.

## 2. Restore a message by the commit that reply already recorded

A message is a database row. A commit is a git snapshot of the app folder. Only the assistant row connects them.

- `sourceCommitHash` is `git HEAD` when the reply starts, before that reply changes files. It is set in `src/ipc/handlers/chat_stream_handlers.ts` when the placeholder assistant message is inserted.
- `commitHash` is the new snapshot when the reply finishes and the turn changed files. Read-only Discovery skips `commitAllChanges`, so this stays empty (`src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`).

A user message stores neither hash. Restore on a user message means put the files back to how they were before that message. `resolveTargetCommitHash` in `src/ipc/handlers/version_handlers.ts` looks forward for the next assistant's `sourceCommitHash`, then backward only for `commitHash`, then `initialCommitHash`.

On the Discovery screen the user message is last, so the forward look finds nothing. The kickoff reply has `sourceCommitHash` and no `commitHash`, so the backward look skips it. `initialCommitHash` is null, and the yellow warning is returned. Ask mode still does not commit. The lookup is what changes.

### Change

- Backward scan: use the nearest earlier assistant `commitHash`, and when that is empty, its `sourceCommitHash`.
- When every hash is still null, say `This message did not change the project files, so there is no version to restore.`

### Tests

- Discovery shape: assistant with `sourceCommitHash` only, then the user message, `initialCommitHash` null. The result is that `sourceCommitHash`.
- Every hash null returns null, and the handler test expects the new warning.

## 3. Three phase chats are the only workspace

`createApp` inserts Discovery, Implementation, and Delivery, then copies the template and commits (`insertFactoryPhaseChats` in `src/ipc/handlers/app_handlers.ts`). Copy and import call that same insert.

Other paths still create chats. `assertFactoryChatCreationOpen` allows `createChat` until all three titles exist (`src/ipc/utils/factory_phase_chats.ts`). The home flow's `ensureFactoryPhaseChats` creates the later phases through `createChat` again. Plan handoff and security fix each create another chat. `getChats` then drops non-phase chats and, when the three titles are not all present, calls `deleteAppById`. The open page still has the old id, and `getChat` throws `Chat not found`.

### Change

- `createApp`'s `insertFactoryPhaseChats` is the only creation of the workspace. Copy and import keep calling it. They do not add a fourth chat.
- `createChat`, `ensureFactoryPhaseChats`, plan handoff's new chat, and the security-fix chat throw `DyadError` kind `Validation`: `An app workspace has its three phases.`
- `getChats` does not delete the app and does not insert stand-in chats. Missing phase titles throw the same validation error.

### Restore targets a message

Restore copies the chat up to the chosen user message and, when requested, the files at that message's commit. An answer is not restored, and an answer is not a floor. The next question after an older message can be a different question, so the previous answer and the page rendered from it are not reused. The questionnaire result stays in the assistant message.

### Tests

- Replace `deletes an app whose chats are not the three phase titles`. `getChats` throws, and the app row and its chats remain.
- `create-chat` throws for an app with no chats, one phase, or all three.
- `createApp` returns exactly Discovery, Implementation, and Delivery.

## Out of scope

- Turning off the app-blueprint gate.
- A git commit for each Discovery reply.
- A saved answer row, or a rule that blocks restore before the latest answer.
- Preview workflow branches, the `preview` label, and Devbox idle shutdown.

## Verification

```sh
npm test -- src/control_plane/file_sync.test.ts src/ipc/handlers/chat_handlers.test.ts src/ipc/services/app_runtime_service.test.ts
```

Add the `resolveTargetCommitHash` test beside the version handler tests and include that file in the same run.
