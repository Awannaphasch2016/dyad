# Open the same app from a pasted address, send a message once, and say when the project folder is missing

> For approval. A new browser tab starts with empty memory. The address, the saved chat, and the project folder are the values that exist. The page may show a result only after the value it depends on has resolved.

## Points to approve

1. Pasting a Discovery address into a new tab opens that Discovery chat. The page shows "App not found" only after the server has answered and the app id is absent. While the list is still loading, or the load failed, the page waits or shows that failure.
2. One send becomes one user message and one reply. A second tab, a second tap during that turn, or the automatic Discovery and Delivery opening line cannot admit another copy of the same text while that turn is still running.
3. A message asks Git for a commit only when the project folder is on disk and is a Git repo. A missing folder stops the turn with "This project's files are missing." It does not show the dugite `ENOENT` text, and it does not call the model.
4. If creating an app fails after the app row is saved, that row and its three chats are deleted. The two preview apps whose folders are already gone can be deleted as test data. This change does not delete any other app.
5. Each browser tab stays a page on the one preview server. This change does not give every tab its own window.

## Variables

| Variable | Depends on | When it is valid | Owner |
| --- | --- | --- | --- |
| Address `appId` and `chatId` | the pasted URL | as soon as the route has parsed | the router |
| App list | `listApps` for the signed-in account | after that request settles | `useLoadApps` |
| Selected app | the address id found in a settled list, or a server miss | after the list settles | app details, title bar |
| Chat turn | one accepted intent for that chat | while that intent is admitting, queued, or streaming | chat-stream host |
| Opening line | the phase chat having no user message yet | once per chat, on the server | factory kickoff |
| Project folder | the app row's path on disk | before a turn reads Git | `getDyadAppPath` |
| Commit hash | the project folder and `.git` | only when both exist | `getCurrentCommitHash`, as a read |

Order:

1. Read `appId` and `chatId` from the address.
2. Load the app list. Until it settles, the app is unresolved.
3. A settled list that contains the id selects that app. A settled list that does not contain the id is "App not found."
4. An address with a chat id stays on `/chat`. An empty chat list redirects to app details only after that list has loaded successfully.
5. A send is admitted once. The same text is not admitted again while that turn is still in flight.
6. A turn reads the commit hash only after the folder and `.git` are present.

## What went wrong

### Pasted address

`selectedAppIdAtom` starts as `null` in each tab. The title bar and app details do not read the app from the server. They search the in-memory list:

```ts
const selectedApp = appId ? appsList.find((app) => app.id === appId) : null;
```

`useLoadApps` returns `data ?? []`, so a list that has not arrived is an empty list. App details renders "App not found" for that empty list. The title bar renders "No app selected" from the same lookup. The query does not retry. A failed load stays empty, and the page still says the app is missing.

`/chat` with no chat id redirects to app details when `chats` is empty. `useChats` also uses `data ?? []`, and a failed fetch is not loading. That redirect can run before the app exists in the list, which lands on the same "App not found" screen.

The first tab still shows the app because its list was already filled when the app was created.

### Repeated messages

Each purple bubble is a saved turn with its own intent id. The matching reply means the model ran again. The host already queues a second submit while a turn is active, then runs that queued submit when the first turn ends. Identical text is not collapsed, so one word sent again while the reply is running becomes another full turn.

Discovery and Delivery also send their opening line from `FactoryPhaseBar`. The "already sent" mark is a React ref in that tab. A second tab has its own ref, sees an empty chat, and sends the opening line again.

The questionnaire follow-up already uses the question id as its intent id, so that answer is admitted once. Words still sitting in the composer are a separate submit.

### Missing project folder

Every local-agent turn writes the assistant placeholder with `getCurrentCommitHash` before the model runs. That call runs Git in the app folder. Dugite turns a missing folder into `ENOENT: Git failed to execute` and mentions its own packaging. The chat stream catch pastes that text into the red box.

wise-binturong-beam still has an app row. Its folder is not on disk, so the next message hits this path. dazzling-bear-chirp was created later, its folder exists, and its messages proceed.

On this branch, `createApp` inserts the app and the three phase chats before template copy and Git init. If that later step throws, the row remains unless the create was a first-prompt operation. The app can be opened, and the next message asks Git to run in a folder that was never finished.

## What the person sees

1. You create an app and open Discovery. You copy that address into a new tab. The new tab opens the same Discovery chat and shows the app name. It does not show "App not found."
2. You send one word. It appears once, and the reply appears once. Sending that same word again while the reply is still running does not add another copy. After the reply is finished, sending it again is a new message.
3. Approving Discovery still prefills Implementation. Sending that prefill once produces one user message and one reply.
4. You open an app whose folder is gone and send a message. The chat says "This project's files are missing." The model is not called.
5. A create that fails during Git init does not leave an app in the list.

## What we will change

- `src/pages/app-details.tsx` — read `loading` and `error` from `useLoadApps`. While the list is loading, show a loading hold. When the load failed, show that error and a way to try again. Render "App not found" only when the list has settled and the address id is not in it.
- `src/app/TitleBar.tsx` — while the list is loading and the address has an app id, keep the button quiet. "No app selected" is for a settled list with no selected app.
- `src/hooks/useChats.ts` — return the query error. `src/pages/chat.tsx` redirects to app details only when the chat list loaded, the address has no chat id, the app id is set, and the list is empty. A chat id in the address stays on `/chat`.
- `src/chat_stream/host_transition.ts` — while a turn is admitting, streaming, or queued, a submit whose trimmed text matches that in-flight text, and which has no attachments, is ignored. A different text still queues. After the turn has finished, the same text can be sent again.
- `src/components/chat/FactoryPhaseBar.tsx` — the opening-line send stays, and the server is the lock. A kickoff prompt (`Start Discovery.` and the Delivery opening line) is admitted only when that chat has no user message and no kickoff already in flight. The per-tab ref cannot admit a second copy.
- `src/components/chat/ChatInput.tsx` — set the in-flight send guard at the start of `handleSubmit`, before any await, so Enter and the send button cannot both pass.
- `src/ipc/handlers/chat_stream_handlers.ts` — before `getCurrentCommitHash`, if the app folder is missing, throw `DyadError` with kind `NotFound` and the message "This project's files are missing." If the folder exists and `.git` does not, throw `DyadError` with kind `Precondition` and the message "This project is not ready." Do not call the model. Do not pass through the dugite `ENOENT` text.
- `src/ipc/handlers/app_handlers.ts` — if `createApp` fails after the insert, delete that app and its chats before the error returns.

## What we will not change

- One preview server for every browser tab. Tabs do not become separate Electron windows.
- The questionnaire follow-up intent id. That answer is already admitted once.
- Sending a different message while a reply is running. That message still waits and then runs.
- Sending the same words again after the reply has finished.
- Recreating a Git repo for an app whose folder is already gone.
- Deleting apps other than the two preview apps whose folders are missing. Those two are test data and can be removed on the preview. The code does not delete by name.

## How we will check it

- App details with a loading list does not render "App not found." A settled list that lacks the id does.
- `/chat?id=&appId=` stays on the chat. `/chat?appId=` with a successfully loaded empty chat list goes to app details. A failed chat fetch does not.
- Two submits of the same text, while the first is in flight, leave one user message. "Coffee" followed by "Hey" leaves both.
- Two callers of the Discovery opening line leave one user message.
- `getCurrentCommitHash` is not called when the app folder is missing, and the turn error is "This project's files are missing."
- `createApp` deletes the inserted app when Git init throws, and keeps the app when init returns a hash.

## Decision log

- The address is the source of truth for a new tab. The in-memory list is a cache. An empty cache is unresolved, not a miss.
- Duplicate bubbles are extra admitted turns. Hiding a bubble in the renderer would leave the extra reply. The host drops the extra in-flight copy.
- The opening line is one fact about the chat, so the lock lives on the server.
- A missing folder is `NotFound`. A folder that is not a Git repo yet is `Precondition`. Both stay out of PostHog exception floods. The dugite packaging sentence is an internal spawn failure, not the message to show.
- Git init stays inside `createApp`. A chat turn does not create a repository it found missing.
- A separate window per browser tab is a larger change. These three bugs are fixed by resolving the address, admitting one in-flight turn, and reading Git only after the folder exists.
