# Owe the builder run before the browser socket opens

This plan does not change code. It records the fix for the live run where the Project Manager’s agent socket failed while connecting, the later connection stayed up, and Orange never asked a question.

## What this is trying to do

Creating the app owes the builder a run. That fact is stored on the Durable Object when the session is created, before any browser connects. A socket that opens later, including one that opens only after earlier handshakes failed, starts that run. A socket that never opens cannot lose it.

The websocket stays the live view. It is not the place that decides whether the run exists.

Cloudflare Workflows are not part of this fix. They are the tool for a model call or a wait that must survive the Durable Object itself being evicted. This failure happened earlier. The run was never handed to the object, because the start still lived on the first browser socket.

## What happened

The Project Manager’s page reached the chat. The launch turn was on screen. The agent socket then failed before it opened, twice. Each failure logged two debug warnings, one from the error event and one from the close event, so the badge went from 0 to 2 to 4. A later attempt opened and stayed open. Orange posted “Seems we lost connection for a while there. Fixed now!” No builder text appeared after that. The Developer’s socket did not fail.

The close code was not kept. The retry reason is written only to the debug console. The transcript drops that line because its id is `websocket_retrying`. This plan does not depend on recovering that code. The handshake can still fail. The run must start anyway.

## Why the later connection did not start the builder

`shouldBeGenerating` is the Durable Object’s “keep going” flag. A connected browser already sends `generate_all` when that flag is true, and the object already ignores a second `generate_all` while a run is in progress.

The flag is set only inside the handler for `generate_all`. The browser sends that message from the first socket open, and only while the path is still `/chat/new`. Both failed attempts died before `onopen`, so the flag stayed false. The attempt that opened was a retry. By then the path was `/chat/<id>`, and that open does not send `generate_all`. The resume path then saw nothing to resume.

The same page had already received the account name from `GET /api/org/question`. The page, the membership read, and the poll were working. The lost fact was the owed run.

## How to read the matrix

Same columns and same rule as [vibesdk-participant-avatars.md](vibesdk-participant-avatars.md).

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as it does today.

This row does not reopen belonging, who may create, who may open, the header, one answer, fallback, another organization, the avatars, the question message, or the absence of a phase strip.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. One row per person: `org_id` and `role_id` (`project-manager` or `developer`). Read at request time. This run does not write it. |
| Sign-in | Clerk identifies the person. The browser also stores a display string, `sessionStorage` key `vibesdk-shared-role` (`Wewebplus · Project Manager` or `Wewebplus · Developer`). That string is the account signed in on this browser. |
| App record | Vibe SDK D1 `apps`. `org_id` is belonging. `created_by` is the account that used the create permission. `userId` is the builder’s copy of that account. `visibility` is the gallery flag. |
| Question record | Vibe SDK D1 `questions` and `answers`. Status is `open` or `answered`. `answers.user_id` is the account that answered. `answers.body` is the reply. One answer row per question. |
| Agent run | The Durable Object for that app: the prompt, the files, the preview, `shouldBeGenerating`, and `ask_questions`. `organizationHold` stops the question text from being broadcast as ordinary chat. |
| Permissions | Who may create, who may open, who receives the question body, and the refusal of delete and gallery changes. |
| Controls | Which Enter works. Home Enter, chat Enter. The question box has no field. |
| Chrome | What is drawn. Human turns, the builder turn, avatars, the question, and the waiting state. |
| Delivery | How the two browsers receive state. The shared agent socket, the per-socket question message, and the poll every two seconds. |
| Other products | Electron, hitl-web, Bolt, phase names, and the shared `wewebplus.apps` / `wewebplus.questions` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The builder run is owed when the session is created | Leave. | Leave. | Leave. Creating still writes `org_id` and `created_by`. Do not add a column for the owed run. | Leave. An open question still means the first run has already finished by asking. | Change. At the end of `initialize`, after the behavior’s own state is stored, set `shouldBeGenerating` to true. This happens in the create request, before the response stream closes and before the browser connects. A second `generate_all` while `isCodeGenerating()` is true remains a no-op. When that first run finishes, including by asking a question, the existing handler clears the flag. | Leave. Only the Project Manager’s create request reaches `initialize`. | Leave. Home Enter and chat Enter are unchanged. | Leave. The reconnect sentence may still be drawn. It is not the run. | Change. On every `agent_connected`, if `shouldBeGenerating` is true and this page is not already generating, send `generate_all`. That includes a retry after a failed handshake, and it includes the Developer’s socket attaching to an app whose run is still owed. Do not send `generate_all` from the socket-open handler based on the path still being `/chat/new`. There is one send site. | Leave. The edit stays in the preview patch. Do not alter shared `wewebplus` columns, Electron, hitl-web, or Bolt. |

## What the edit touches

The preview patch is `deploy/preview/vibesdk-org-run.mjs`, on top of `cursor/vibesdk-participant-avatars-0539`. It patches the pinned Vibe SDK. It does not fork the pin.

- `worker/agents/core/codingAgent.ts`, in the existing `patchCodingAgent`. After `behavior.initialize` has stored the new session, set `shouldBeGenerating` to true. `initialize` runs once per app, from the create request. Opening an existing app does not call it.
- `src/routes/chat/utils/handle-websocket-message.ts`, in the existing `patchConversationHandler`. The send of `generate_all` on `agent_connected` currently sits inside the first-restore branch. Move that send so every `agent_connected` performs it when `state.shouldBeGenerating` is true and generation is not already active on the page. The first successful socket of the failed run never restored state. A later socket on the same page must still send.
- `src/routes/chat/hooks/use-chat.ts`. Add a patch. The open handler sends `generate_all` only when `urlChatId === 'new'`. Remove that send. The open handler still sends `get_conversation_state`.

The server handler in `worker/agents/core/websocket.ts` already sets the flag again when `generate_all` arrives, starts `generateAllFiles` when no run is active, and clears the flag when that call finishes. Leave that handler.

## What stays as the last run left it

- Only the Project Manager’s Enter on the home box creates an app. The Developer’s Enter does not.
- Both roles in the organization may open the app.
- The human label is the account name. The role is not appended. The three avatars stay.
- The question text is an Orange message for the named role. The other role sees the pending interaction and not the body.
- One answer resumes the builder through `handleUserInput`, which queues the reply and calls `generateAllFiles` when the object is idle. A second answer does not.
- A reconnect while a question is open does not start another run. The flag is already false by the time the question is open.
- “Waiting on the Project Manager.” is not drawn as its own bubble.
- The header does not say a person owns the app. **Private** and **Make public** stay off both screens.
- Delete and changing the gallery flag stay unavailable.
- There is no second prompt box and no phase strip.
- Shared `wewebplus` is not altered.

## What this does not fix

A handshake can still fail. The debug badge can still climb. The “Fixed now” line can still appear. Those are symptoms of the socket. This plan makes them irrelevant to whether Orange starts.

If the Durable Object is evicted in the middle of a model call, the in-memory `generationPromise` is gone. `isCodeGenerating()` is not durable state. Surviving that eviction is the Cloudflare Workflows problem, and it is out of this row. `step.waitForEvent` would be the pause while a person answers. Do not add a Workflow in this change.

## Important changes

1. The create request records `shouldBeGenerating` on the agent before the browser connects.
2. Every successful agent connection sends `generate_all` when that flag is set. The path `/chat/new` is not the condition.
3. A second `generate_all` during an active run does nothing.
4. The flag is cleared when that run finishes, including when it finishes by asking a question. A reconnect does not ask again.
5. The answer still resumes the builder through the existing user-input path.
6. Cloudflare Workflows are not added.
7. Chrome, Enter rules, belonging, and shared `wewebplus` stay as they are.

## How to verify

| Row | Change check | Leave check |
| --- | --- | --- |
| The run is owed at create | The unit test shows `initialize` setting `shouldBeGenerating` after the behavior state is stored, and shows `generate_all` sent from every `agent_connected` while that flag is true. The socket-open handler no longer sends it because the path is `/chat/new`. On the live two-role check, Orange asks a question even if the Project Manager’s socket fails and then posts “Fixed now.” The named role sees the question. The other role sees the pending interaction and not the question text. One answer resumes the builder once. | The Developer’s Enter on the home box still does not create an app. A reconnect while a question is open does not produce a second question. The header still has no **Private** and no **Make public**. Shared `wewebplus` columns are untouched. |
