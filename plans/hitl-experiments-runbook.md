# One pass of the shipped Dyad app

Revised again after the storage and session review. The scaffolding already on this branch stays at the bottom. It is not the proof.

## Important points

1. One organization, one app, two roles. Neon is not part of this proof.
2. One Dyad process and its SQLite file hold the run. Two browsers attach to that process through the browser bridge.
3. Each browser has its own Clerk session. The bridge today stores one token for every tab. That has to become one token per connection.
4. The app row in that SQLite file is owned by the organization. Questions and approvals stay in that file. `presentQuestion` already shows the body and the form only to the target role, and the waiting line to the other role.
5. While a window is looking at that app, it refetches that app's phase state, phase chats, and questions. Leaving the app stops that window's refetch. It does not stop the run, and it does not change the other window.
6. A factory phase has no chat composer and no comment box. The person answers a card or approves. Discovery, Implementation, and Delivery each start on their own when the phase opens.
7. The agent writes the question. The test checks the role, the order, the pause, and the resume. It does not require a fixed sentence.
8. The Cursor key stays in the Dyad process. The desktop poller creates the question and sends the follow-up when the form is submitted.

## Objective

Show that one shared app run works for both members of Wewebplus.

- Discovery, Implementation, and Delivery happen in that order.
- Both people see the same phase, the same running or waiting state, and the same summary.
- A question is one row. The target role gets the card and the form. The other role gets the waiting line and does not see the body.
- Submitting the form continues the same agent. The next prompt contains the answer.
- Approving is the project manager's button. The developer cannot approve. The next phase starts without anyone pressing Send on a prepared prompt.

## Storage

SQLite in this process is the record. `hitl_questions`, `factory_phase_approvals`, and the phase chats are the rows both windows read.

Neon stays unused. It exists so a second computer with its own SQLite file can see the same organization. This proof is one process, so that copy is not required. Roles come from the Clerk membership.

The app row must have `ownerType` org and the Wewebplus org id. `listQuestions` refuses any other app.

## Sessions

Two Playwright browser contexts open the bridge URL. One is the project manager. One is the developer.

`src/main/browser_bridge.ts` gives every tab the sender id `-1`, and `session_store.ts` keeps a single token there. Signing in on the second context replaces the first. The change is to remember the Clerk token on that websocket and pass that token into `resolveAccountSession` for invokes from that socket.

Both contexts then call `listQuestions` on the same database. `presentQuestion` does the rest.

## What the window refetches

`selectedAppIdAtom` is this window's current app. `factoryHostManaged` is a flag on that app's row.

When the phase bar is showing a factory-host-managed app, it already refetches that app's factory state and its three phase chats every second. The question query does not. Add the same interval to the question query and the approval query for the selected app.

Switching apps changes only this window's atom. The queries follow the newly selected app. The other window keeps polling the app it still has open. A factory run is a `factoryHostRuns` row in the main process, keyed by app id. Changing the selected app does not write one.

The poll stops when this window leaves the chat page, because the phase bar unmounts. The rows remain. Opening the app again reads them.

## What a person can do

On a factory phase chat, do not render `ChatInput` or the phase comment form. `HitlQuestionList` and the approve button are the controls.

`factoryPhaseKickoff` already returns a start string for Discovery and Delivery, and an effect sends it when that phase chat is empty. Implementation returns nothing, and **Approve and continue** only fills the composer via `continuePrefill`. Implementation gets that same string as its kickoff. `approveAndContinue` records the approval and selects the next phase. It does not wait for Send.

The waiting line is the existing card: "Waiting on Project Manager" or "Waiting on Developer", with no body and no form. It is not a chat message.

## The run

One process. Two browsers. One app. Three phase chats.

1. Both browsers show Discovery open. Implementation and Delivery are locked.
2. Discovery starts. The agent runs. The prompt does not name the questions and does not say Discovery is already approved.
3. The agent stops with a request. Both browsers, still on this app, show the question. The target role sees the body and the form. The other sees the waiting line.
4. The target role submits the form. The question stays open until that submit. The same agent continues, and the next prompt contains the answer. The other role still does not see the body.
5. The summary appears in both browsers. Continue is enabled for the project manager and not for the developer. Delivery stays locked.
6. The project manager approves. Implementation unlocks and its kickoff runs. Nobody presses Send.
7. Implementation asks whatever question the agent asks. The same split applies. If it asks the developer, the project manager sees the waiting line.
8. The project manager approves the Implementation summary. Delivery starts on its own.
9. Delivery reaches its summary. The project manager approves delivery. The developer cannot.

The Cursor agent is a normal agent for this app's repository. The marker may be in the phase prompt. The prompt must not list the questions.

## Changes

| Piece                         | Change                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser bridge session        | One Clerk token per websocket. Invokes from that socket use that token.                                     |
| Question and approval queries | Refetch on the same one-second interval as the factory-host-managed phase chats, for the selected app only. |
| Factory phase chat            | Do not mount `ChatInput` or the comment form.                                                               |
| Implementation                | `factoryPhaseKickoff` returns the build prompt. `approveAndContinue` does not prefill the composer.         |
| Neon                          | Not configured for this run.                                                                                |

No second Electron user-data directory. No second workflow. No UI agent for each role. Playwright opens the two contexts, waits on the test ids, types the answer, and clicks approve. The answer text can come from a function that sees only the question body and the role. Playwright is the only thing that clicks.

## Evidence

Both browsers recorded for steps 1–9, including a moment when one person has left the app and the other still sees it moving. The log records the app id, the question ids, the answer ids, the Cursor run ids, and the approvals. It does not record the Clerk tokens or the Cursor key.

The plan is done when those steps are visible. A green unit test does not close it.

## What the scaffolding already established

Kept. None of it is the run above.

- The parser, the classifier, a question with no bead, one resume per answer, and resume after a restart are covered by unit and bridge tests.
- Both Continue IPC paths refuse a developer and accept a project manager. The bridge machine token can still approve.
- Two Cursor passes in GitHub Actions wrote `## Request for project-manager`, then `## Request for developer`, then `## Implementation summary`. They started in Implementation because the prompt said Discovery was already approved. The prompt named both questions. The agent had no repository. [Run 38007957688](https://github.com/Awannaphasch2016/dyad/actions/runs/38007957688), [run 38027897774](https://github.com/Awannaphasch2016/dyad/actions/runs/38027897774).
- The desktop poller and `factory:ensure-cursor-phase` are on this branch. With no key, the local chat starts as before. That wiring is not the two-browser run.

Section 8 decisions from the scaffolding still stand as bridge findings: no bead for these questions, the marker is the carrier, resume stays in the bridge, `resolve_hitl_answer.py` stays for bead gates, `stepId: "question"` stays, both approval paths stay behind `requirePhaseApproval`.

## Still out of scope

A second organization. Neon, including editing its schema. A second Dyad process. Configurable phases. Paperclip. Spec Kit or OpenSpec. Editing `scripts/gascity/`, GasCity, or `hitl.py`. A webhook. Putting the Cursor token in the agent environment. Removing SQLite from the desktop.

## Order

Per-connection session, then the question and approval refetch, then hide the composer and auto-start Implementation. Then do steps 1–9 once and record both browsers. Do not add another isolated pass to stand in for a step the browsers have not shown.
