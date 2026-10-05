# Fix the three preview walkthrough failures

The walkthrough on `https://pr-34.anakwannaphaschaiyong.com` hit three failures. This plan fixes the code that produces them. The preview container's `main.log` is not on this machine, and GitHub Actions logs were not readable (`gh` returned HTTP 401). The screenshots plus the functions that emit those exact messages are the evidence.

## What failed

1. **sincere-koala-hug had no `package.json`.** Implementation opened the preview. The runner executed `pnpm install`. pnpm printed `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` for `/home/weaver/dyad-apps/sincere-koala-hug`. The same chat rejected `write_file` until the app blueprint is approved, and the only file that landed was `src/pages/Index.tsx`.
2. **busy-iguana-bloom could not restore.** Discovery is an ask chat. Restore of "Fatbud the bkk weed shop" returned "Could not determine a version to restore to for this message."
3. **A red toast said `DyadError: Chat not found`.** The page still showed the transcript. A later lookup used a chat id that was no longer a row.

The blueprint gate stays. It is doing what it is written to do. A missing project fails immediately. An app workspace is created only as the three phase chats.

## 1. Do not create an empty git folder

### Cause

`getApp` calls `ensureProjectFiles` when the folder has no `.git` (`src/ipc/handlers/app_handlers.ts`, the block around the `projectFilesOnThisMachine` check).

`ensureGitRepository` in `src/control_plane/file_sync.ts` creates the directory and runs `gitService.initRepoWithInitialCommit`. It does not copy a template. The existing test `creates a git repository when the app folder does not exist` expects that empty commit. That empty commit is the fallback. The preview then runs `pnpm install` because `choosePackageManagerFromSignal` returns `pnpm` when the folder has no `package.json` and no lockfile (`src/ipc/utils/package_manager_selection.ts`). `buildPnpmInstallAndRunCommand` in `src/ipc/services/app_runtime_service.ts` is what prints `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.

The only path that creates a project is `createApp`: `createFromTemplate`, then `initRepoWithInitialCommit`, then the `initialCommitHash` update (`src/ipc/handlers/app_handlers.ts`).

### Change

- `ensureProjectFiles` does not create a directory, does not run `git init`, and does not copy a scaffold. If the app directory is missing or has no `.git`, throw `DyadError` with kind `Precondition` and a message that the project files are missing. `getApp` lets that error reach the UI.
- `getDefaultCommand` does not spawn pnpm or npm when `package.json` is absent. The preview entry is `This app has no package.json, so the preview cannot start.` That is a stop, not a repair.

### Tests

- Replace `creates a git repository when the app folder does not exist` in `src/control_plane/file_sync.test.ts`. A missing folder throws, and the directory is not created.
- A folder that already has `.git` is still left on its current commit.
- A runtime-command test: no `package.json` does not produce a `pnpm install` command.

## 2. Discovery restore must find the commit the turn already recorded

### How a message and a commit relate

A chat message is a row in the database. A commit is a git snapshot of the app folder. They meet on the assistant row:

- `sourceCommitHash` is written when the assistant reply starts. It is `git HEAD` at that moment, the files as they were before this reply changes anything. The write is the `getCurrentCommitHash` call in `src/ipc/handlers/chat_stream_handlers.ts` when the placeholder assistant message is inserted.
- `commitHash` is written when the reply finishes and the turn actually changed files. `commitAllChanges` creates that commit, then the handler stores it on the same assistant row (`src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`).

User rows do not store either hash. Restore is offered on a user message and means "put the files back to how they were before this message." The handler finds that snapshot from the assistant rows around it.

A message has no `commitHash` when the turn did not change files. Discovery is ask mode, so the turn is read-only and the handler skips `commitAllChanges` on purpose. The reply can still have `sourceCommitHash`, because that is recorded at the start from the current `HEAD`. A factory-host status row has neither hash, because `postFactoryHostMessage` inserts only role and content.

### Restore lookup

`resolveTargetCommitHash` in `src/ipc/handlers/version_handlers.ts`:

1. Look at messages after the chosen user message. The first assistant's `sourceCommitHash` is the files at the start of the reply to that message. That is the restore target.
2. If that assistant has no `sourceCommitHash`, stop looking forward.
3. Look backward for an earlier assistant's `commitHash`. That commit is the files that assistant left behind, which is the state just before the chosen user message.
4. Otherwise use the chat's `initialCommitHash`, the snapshot from Create, before any message.

On the Discovery screen the user message is last, so step 1 finds nothing. The kickoff assistant has `sourceCommitHash` and no `commitHash`, so step 3 skips it. Step 4 is null, and both copies of the yellow warning in `restoreToMessage` run.

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

## 3. The three phase chats are the only app workspace

### Cause

An app workspace is the folder, the git repo, and the chats. Today more than one path can create part of that:

- `createApp` inserts Discovery, Implementation, and Delivery, then copies the template and commits (`insertFactoryPhaseChats` in `src/ipc/handlers/app_handlers.ts`). Copy and import call the same insert.
- `createChat` still creates another chat when the three titles are not all present. `assertFactoryChatCreationOpen` returns without throwing in that case (`src/ipc/utils/factory_phase_chats.ts`).
- The home first-prompt flow calls `ensureFactoryPhaseChats`, which creates Implementation and Delivery through `createChat` again (`src/first_prompt/ensure_factory_phase_chats.ts`).
- Plan handoff creates a chat when "accept in a new chat" is set (`src/plan_handoff/definition.ts`). Security fix creates a chat titled `Fix: …` (`src/ipc/handlers/security_handlers.ts`).
- `getChats` then tries to clean the variation up: it drops non-phase chats and, when the three titles are not all present, calls `deleteAppById`. The open page still has the old chat id, and `getChat` throws `Chat not found`.

### Change

- `insertFactoryPhaseChats` inside `createApp` is the only creation of an app workspace. It always inserts exactly Discovery, Implementation, and Delivery, then the template copy and the initial commit run. Copy and import keep calling that same function. They do not grow a fourth chat.
- `createChat`, `ensureFactoryPhaseChats`, plan handoff's new chat, and the security-fix chat throw `DyadError` kind `Validation` with `An app workspace has its three phases.` Those flows do their work inside the existing phase chat.
- `getChats` does not delete the app and does not insert stand-in chats. If the three phase titles are missing, it throws the same validation error. The UI shows that error. It does not toast `Chat not found` for a chat this list just deleted.
- `assertFactoryChatCreationOpen` rejects every `createChat`, including when the three titles are not all present.

### Answers are the restore floor

An answer is phase state. The planning questionnaire currently writes the answers only into the assistant message (`planning_questionnaire.ts` returns them as message text). Restore copies messages up to the chosen user message into a new chat (`version_handlers.ts`). Choosing a message from before that reply drops the answers, and the phase asks again.

Save the submitted answers on the phase when the person submits them. The row is the app, the phase, and the answer body. The chat message can still show the reply.

The latest saved answer is the earliest point restore may target in that phase. Restore to that answer's message, or to a later message, still works. Restore to an earlier message is refused: `These answers are already saved.` The questionnaire for that phase does not open again. A newer submission moves the floor forward. Code commits made after the answer can still be restored, down to the commit recorded with that answer, and no earlier.

### Tests

- Replace `deletes an app whose chats are not the three phase titles`. `getChats` throws, and the app row and its chats are still in the database.
- `create-chat` throws for an app with no chats, an app with one phase, and an app with all three.
- A test that `createApp` returns three chats titled Discovery, Implementation, and Delivery, and no others.
- Submitting a Discovery questionnaire writes a phase answer row. Restore to a message before that answer is refused. Restore to the answer message keeps the row and the reply.

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

- Opening an app whose folder was never created fails with the missing-project error. It does not create a git directory, and it does not print `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.
- Restore on the first Discovery user message uses the kickoff reply's `sourceCommitHash`.
- Creating an app makes exactly three phase chats. A request for any other chat is rejected, and opening the app does not delete it.
- After a Discovery answer is submitted, restore cannot target a message from before that answer. The same questions are not asked again.
