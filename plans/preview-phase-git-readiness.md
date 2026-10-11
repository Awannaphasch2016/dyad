# Open the preview only for Implementation, and only after the project is ready

> For approval. This follows the state model: a value is usable only after the variable it depends on has resolved. Rendering follows that result.

## Points to approve

1. The preview’s lifetime follows the Implementation phase. It opens when the open chat is Implementation. It stays closed for Discovery and Delivery. While that chat’s title has not loaded, the preview stays closed and the website is not started.
2. Starting the website is the next step, not the same step. It runs only when the preview is open and the app folder has both `.git` and `package.json`.
3. Creating an app still initializes Git inside `createApp`, and `createApp` still returns only after that first commit. If init fails, that app row and its three chats are deleted. A failed create does not leave an app you can open.
4. Until the folder is a finished project, the header does not toast “Not a git repository”, does not show “Version 0”, and the preview does not show “Failed to run app”. One status covers that wait: the project is not ready.
5. A chat that is not Discovery, Implementation, or Delivery keeps today’s preview. On Implementation, closing the preview yourself stays closed until you leave that phase.
6. The Clerk membership toast, Neon, the Postgres driver, the blueprint, the bridge dialog, and the tab note stay out.

## Variables

| Variable | Depends on | When it is valid | Owner |
| --- | --- | --- | --- |
| `phase` | the open chat’s title | after that chat row is loaded | chat page, from the stored title |
| `previewOpen` | `phase` | same lifetime as `phase`; true only for Implementation | chat page, via `previewOpenForPhase` |
| `projectReady` | `.git` and `package.json` | true only when both are on disk | `createApp` writes them; the branch check reads them |
| `branch`, version count | `projectReady` | only after `projectReady` is true | version handlers, as reads |
| run | `previewOpen` and `projectReady` | start only when both are true | `PreviewPanel` |

Order:

1. Chat id from the URL.
2. Load that chat’s title. Until then, `phase` is unresolved and `previewOpen` is closed.
3. `previewOpen` is true only when `phase` is Implementation.
4. `createApp` copies the template, runs Git init, stores the commit hash, and only then returns. A failure deletes the app it inserted.
5. The dev server starts only when `previewOpen` is true and `projectReady` is true.
6. Branch and version count are reads of that same `projectReady`.

## What went wrong

The preview is given a value before its phase exists. `isPreviewOpenAtom` starts as `true`. The chat page writes the phase rule only after the title is known, and until then it returns without writing. `PreviewPanel` is mounted even while the panel is collapsed, and it calls `runApp(selectedAppId)` from the selected app alone. A new tab on Discovery therefore shows the preview and starts the app. That start is the “Failed to run app 1” banner. The banner’s “restart your computer” hint is the generic label on that failure.

Git init is not skipped on a successful create. The template copy removes the template’s `.git` on purpose. `initRepoWithInitialCommit` then runs, and `createApp` returns only after the commit hash is stored on the chats. There is no successful return that skips init.

The error is still possible because the app row and the three phase chats are saved before that init, so a refresh can open Discovery while init is still running. If init throws, `commitCreation` keeps the app. The delete runs only when creation was cancelled. `ensureProjectFiles` then sees a folder with no `.git`, checks `package.json`, and returns. It does not run `git init`.

Three readers treat that missing folder as a finished answer:

- `getCurrentBranch` throws “Not a git repository”, and `useCurrentBranch` toasts it.
- `listVersions` returns `[]`, and the header shows that as “Version 0”.
- The runner throws “Failed to run app” when `package.json` is missing.

If that chat already has a model reply, `createApp` had returned, so `.git` existed at that moment. The toast means the folder the branch check reads does not have `.git` now. This plan does not claim the file was deleted. It stops the page from treating “not ready” as three errors, and it stops a failed init from leaving an app behind.

## What the person sees

1. You create an app. The app appears in the list only after Git init has finished. If init fails, the create reports the failure and the app is not in the list.
2. You open Discovery. The messages are there. The preview stays closed. The website is not started. There is no “Not a git repository” toast and no “Version 0”.
3. You open Implementation. The preview opens. If the folder has `.git` and `package.json`, the website starts. If it does not, the preview shows one line that the project is not ready, and the header stays quiet.
4. You open Delivery. The preview closes.
5. You close the preview while you stay on Implementation. It stays closed until you switch away and come back to Implementation.

## What we will change

One pure function decides the preview. The chat page applies it. `PreviewPanel` uses the same function before it starts the app. The branch check reports readiness instead of throwing.

- `src/lib/factoryPhase.ts` — add `previewVisibility`. Inputs are whether the open chat’s title is loaded and the phase from that title. Results are `unresolved`, `open`, or `closed`. Unknown title is `unresolved`. A factory phase uses `previewOpenForPhase` (open only for Implementation). A loaded chat with no factory phase is `open`, which keeps today’s preview for ordinary chats.
- `src/pages/chat.tsx` — apply `previewVisibility` for the open chat. `unresolved` and `closed` force the preview shut, including when another writer opens it later on Discovery or Delivery. Entering Implementation opens it once. Closing it while the phase stays Implementation is left as is.
- `src/components/preview_panel/PreviewPanel.tsx` — call `runApp` only when `previewVisibility` is `open` and `projectReady` is true. The selected app id alone does not start the app. While Implementation is open and the project is not ready, show one status in the preview area: the project is not ready. Do not show the restart hint for that status.
- `src/ipc/types/version.ts` — `BranchResult` gains `projectReady: boolean`. `branch` is present when `projectReady` is true.
- `src/ipc/handlers/version_handlers.ts` — `getCurrentBranch` returns `{ projectReady: false, branch: null }` when `.git` or `package.json` is missing. It does not throw “Not a git repository” for that case.
- `src/hooks/useCurrentBranch.ts` — a `projectReady: false` result is data. It does not toast.
- `src/components/chat/ChatHeader.tsx` — hide the version count while `projectReady` is false. “Version 0” is a count of commits in a real repository.
- `src/ipc/handlers/app_handlers.ts` — if `createApp` fails after it has inserted the app, delete that app before the error returns. `commitCreation` still marks the first-prompt operation finished. It no longer leaves the half-created app in the list.

`ensureProjectFiles` stays a read. It does not grow a second Git init.

## What we will not change

- The rule that a successful `createApp` initializes Git before it returns.
- The early insert of the app row and the three phase chats. That insert stays so a refresh during create cannot treat the app as missing its phases. The page treats that interval as not ready, and a failed init deletes the row.
- Ordinary chats that are not Discovery, Implementation, or Delivery.
- The tab note, the window id, the login cookie, and where messages are stored.
- Clerk membership checks. A failed membership fetch reported as “you are no longer a member” is a separate variable. It is out of this change.
- Neon, the Postgres driver, the blueprint latch, the bridge dialog, and the white Implementation iframe.

## How we will check it

- `previewVisibility`: title not loaded → `unresolved`; Discovery → `closed`; Implementation → `open`; Delivery → `closed`; a loaded chat with another title → `open`.
- `getCurrentBranch` with no `.git` returns `projectReady: false` and does not throw.
- The header hides the version count when `projectReady` is false.
- `PreviewPanel` does not call `runApp` for Discovery, or for Implementation while `projectReady` is false.
- `createApp` deletes the app when init throws, and the app remains when init returns a hash.

## Limit

A chat that already received a model reply was created successfully, so Git init had finished. If that folder later has no `.git`, this change does not recreate the repository. It stops the toast, the “Version 0” count, and the failed run, and it shows that the project is not ready.

## Decision log

- `previewOpen` is derived from `phase`. The atom’s default of `true` is not a resolved phase.
- The dev server is derived from `previewOpen` and `projectReady`. `PreviewPanel` does not own a separate start rule.
- Git init stays inside `createApp`. A read path does not init a repository it found missing.
- A failed init deletes the app `createApp` inserted. Keeping that app is what made “Not a git repository” possible after a create that never finished.
- No new state machine. These are derived values with one owner each. A machine is for a queue of commands, and this change does not add one.
- The membership toast is the same shape (a failed check stored as a final “no”) and stays a follow-up.
