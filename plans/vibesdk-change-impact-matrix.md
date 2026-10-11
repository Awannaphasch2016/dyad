# Change impact matrix for the organization app

This plan does not change code. It records the intended behavior, the state dimensions that actually exist in the Vibe SDK preview, and which of those dimensions each intention must edit.

The behavior below is the organization run already described in [vibesdk-real-agent-hitl.md](vibesdk-real-agent-hitl.md), plus the header inconsistency the live run made visible. The Project Manager sees **Private** and **Make public**. The Developer sees neither. Both are in the same app.

## What this is trying to do

One organization. Two people. One app. The box already on the page is the only place anyone types.

The Project Manager types a prompt in that box and presses Enter. That starts the app. The Developer’s Enter does not start an app. There is no personal app.

Both people then see the same app, the same files, and the same preview. The screen does not say that the Project Manager owns it. The word **Private** and the **Make public** button are the builder’s old way of saying “this person owns an unpublished app.” That sentence is not the ownership of this app. Ownership is the organization. The Project Manager is only the person who was allowed to start it.

When the builder asks, the question popup already on the page shows the question to the named role. The other role sees a waiting line and does not see the question. The named role types the reply in the same box and presses Enter. One reply continues the builder. A second reply does not. A question that names no role goes to the Project Manager. A person in another organization does not find the app.

There is no second box, no extra card, and no Discovery / Implementation / Delivery strip.

The shared database used by Electron, hitl-web, and Bolt stays as it is. Those products still need `owner_type` and `phase`. This run’s organization fields stay on the Vibe SDK app row.

## How to read the matrix

Each row is one intention. Each column is one place this preview actually stores or decides state. The columns came from tracing the preview, not from a generic layer list.

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

Not every row changes every column. A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as it does today.

Some **Change** cells are already true in the preview that recorded the neighborhood-shop run. Those cells say **Change, already true**. The implementation work is the cells that say **Change** without that note.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. One row per person: `org_id` and `role_id` (`project-manager` or `developer`). Read at request time. This run does not write it. |
| Sign-in | Clerk identifies the person. The browser also stores a display string, `sessionStorage` key `vibesdk-shared-role` (`Wewebplus · Project Manager` or `Wewebplus · Developer`). The home page currently uses that string to ignore the Developer’s Enter. |
| App record | Vibe SDK D1 `apps`. The builder writes `userId` (the person who pressed Enter) and `visibility` (`private` or `public`). This run also writes `org_id` and `created_by`. |
| Question record | Vibe SDK D1 `questions` and `answers`. Role, body, `open` or `answered`, `declared` or `fallback`. One answer row per question. |
| Agent run | The Durable Object for that app: the prompt, the files, the preview, and `ask_questions`. `organizationHold` stops the question text from being broadcast as ordinary chat. |
| Permissions | Server decisions that are separate today: `assertProjectManager` on create, `memberCanAccessApp` on open, `checkAppOwnership` (`userId` or org member, and `deleteApp` uses this), `updateAppVisibility` (`userId` only), and the question-body filter. |
| Controls | Which Enter works, and which extra control exists. Home Enter, chat Enter, the Developer-only “Open the organization app” link. |
| Chrome | What is drawn. The header reads the app record: `visibility` becomes the **Private** chip, and `userId === me` becomes **Make public**. The popup and the waiting line read the question poll. The sidebar app list reads `apps.userId`. |
| Delivery | How the two browsers receive state. One shared agent socket, a per-socket question message, and a poll every two seconds (`GET /api/org/app`, `GET /api/org/question`). |
| Other products | Electron, hitl-web, Bolt, phase names, gate names, and the shared `wewebplus.apps` / `wewebplus.questions` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The organization is the only owner | Leave. Roles stay on membership. | Leave. Clerk still identifies the person. | Change. `org_id` is the owner. `created_by` is only who pressed Enter. `userId` and `visibility` stay stored, and they are not the owner. Already true for `org_id` and `created_by`. | Leave. | Leave. The builder may still write `userId` and `visibility: private` when it creates the row. The following claim writes the organization. | Change. Opening the app is “same organization.” Delete and publish are not granted by treating every member as `isOwner`. Today `checkAppOwnership` sets `isOwner` for any member, and `deleteApp` uses that flag. | Leave. | Change. The header must not say a person owns the app. | Leave. | Leave. Do not alter shared `wewebplus` columns. |
| Only the Project Manager launches, from the existing prompt box | Leave. | Leave. The display string may hide the Developer’s Enter. It is not the authority. | Change, already true. A Developer insert does not set `created_by`. | Leave. | Leave. | Change, already true. Create returns 403 unless membership says `project-manager`. | Change, already true. Developer Enter stays on the home box. Project Manager Enter creates the app. | Leave. | Leave. | Leave. |
| Both people see the same app, files, and preview | Leave. | Leave. | Change. The app list and the single-app fetch include the row for every member of `org_id`, not only `apps.userId`. | Leave. | Change, already true. Files and preview belong to the one agent. | Change, already true. A member of `org_id` may open the chat and the preview. | Change. Remove the Developer-only “Open the organization app” link once both people get the app from the same list. | Change. The sidebar list is that same org list. The Project Manager sees it today because `userId` is the Project Manager. | Change. `GET /api/org/app` remains the lookup. Both roles use it. Today only the Developer polls it. | Leave. |
| The header tells both people the same ownership story | Leave. | Leave. | Change. The chat loads the same app record for both roles. Today the Developer’s header has the title from the agent and no app record, so the chip is absent. | Leave. | Leave. | Change. **Make public** is not tied to `userId === me`. Hide that action for both roles. `updateAppVisibility` stays unavailable as an ownership action. | Change. **Make public** is not shown to either role. | Change. Hide the **Private** / **Public** chip for both roles. The gallery column may remain on the row. It is not drawn as ownership. | Change. The header’s app fetch succeeds for the member who did not press Enter. | Leave. |
| The named role sees the question in the existing popup | Leave. | Leave. | Leave. | Change, already true. One open question stores the role and the body. | Change, already true. `ask_questions` publishes that question and holds ordinary text. | Change, already true. The body is returned only to the named role. | Change, already true. Chat Enter is enabled only when this role has the body. The popup has no field. | Change, already true. The existing popup shows the body and “Reply in the prompt box.” | Change, already true. The body is not broadcast to the other socket. The poll feeds the popup. | Leave. |
| The other role waits, and their Enter does not send | Leave. | Leave. | Leave. | Leave. Same question row. | Change, already true. Held text is not flushed as the question. | Change, already true. The waiter does not receive the body. | Change, already true. Enter does nothing without a body. | Change, already true. “Waiting on the Project Manager.” or “Waiting on the Developer.” | Change, already true. The waiting line arrives with the question. | Leave. |
| The named role answers once in the prompt box | Leave. | Leave. | Leave. | Change, already true. One answer. `question_id` is unique. Status becomes answered. | Change, already true. That answer is the next prompt. A second answer does not resume. | Change, already true. Only the named role’s Enter is accepted while the question is open. | Change, already true. The reply is typed in the existing box. | Leave. The reply is an ordinary user message. | Leave. | Leave. |
| A question with no role goes to the Project Manager | Leave. | Leave. | Leave. | Change, already true. Missing or unknown role stores `project-manager` and `fallback`. | Change, already true. The tool allows the role to be omitted. | Leave. The Project Manager is then the named role, so the row above applies. | Leave. | Leave. | Leave. | Leave. |
| Another organization does not find the app | Leave. | Leave. | Leave. Read by `org_id`. | Leave. | Leave. | Change, already true. A different `org_id` is not found. | Leave. | Leave. No question text is drawn. | Leave. | Leave. |
| No second input and no phase walkthrough | Leave. | Leave. | Leave. | Leave. No `phase`, no gate step name. | Leave. | Leave. | Change, already true. No extra card and no phase strip. | Change, already true. No second prompt box. | Leave. | Leave. Do not copy Electron, Bolt, or the phase tables into this run. |

## What the matrix says to implement

The question, waiting line, one answer, fallback, and other-organization rows are already true. Do not reopen them. The open work is the owner story: the app list, the header, and the permission flag that currently calls every member an owner.

Do these in order. Each step names the cells it closes and the cells it must leave alone.

### 1. Split “may open” from “is the owner action”

Closes the permission cell on “The organization is the only owner.”

`memberCanAccessApp` stays the open and preview check. `checkAppOwnership` stops setting `isOwner` for every org member. `deleteApp` and `updateAppVisibility` keep refusing a person who is only a member. `assertProjectManager` stays the create check.

Leave membership, the question record, the agent’s ask-and-hold path, and the shared wewebplus columns.

### 2. Give both roles the same app record

Closes the app-record, controls, chrome, and delivery cells on “Both people see the same app.”

The list of apps and the single-app fetch return the row when `org_id` matches the member, including the member who is not `userId`. Both roles use that lookup. The Developer-only “Open the organization app” link is removed after the shared list shows the app.

Leave the question poll, chat Enter, and the popup.

### 3. Make the header say the same thing to both people

Closes the chrome, controls, permission, and delivery cells on “The header tells both people the same ownership story,” and the chrome cell on “The organization is the only owner.”

The chat header loads the app record for whichever member is signed in. It does not draw the **Private** chip or **Make public**. Those two controls are the old `visibility` and `userId === me` sentence. The `visibility` column may remain on the row because the builder writes it. It is not shown as who owns the app.

Leave the prompt box, the popup, the waiting line, and create-by-Enter.

### 4. Prove the untouched rows

For the question, waiting, answer, fallback, other-organization, and no-phase rows, every **Leave** cell stays as the neighborhood-shop run left it. In particular, fixing the header must not put the question body on the Developer’s socket, must not enable the waiter’s Enter, and must not add a field to the popup.

## How to verify

Verify by row. A **Change** cell needs a check that the new fact holds. A **Leave** cell on a row you edited needs a check that the old fact still holds.

| Row | Change check | Leave check |
| --- | --- | --- |
| Organization owns the app | Both headers omit **Private** and **Make public**. The app row still has `org_id`. A member who did not press Enter cannot delete the app and cannot change `visibility`. | Membership rows are unread-only. Shared `wewebplus.apps` still has `owner_type`. |
| Only the Project Manager launches | Developer Enter stays on the home prompt. The create request for that person is 403. | The question tables are unchanged by a refused create. |
| Both see the same app | Both sidebars list the app. The Developer-only link is gone. Both previews match. | The Developer still cannot launch a second app. |
| Same header story | The Project Manager and the Developer see the same title chrome on the same app. | The gallery column may still be `private` in the row. It is not on either header. |
| Named role sees the question | The popup shows the live question only on the named role’s screen. | The other socket does not contain that text. |
| Other role waits | The waiting line is visible and Enter does not send. | No second copy of the question body is stored. |
| One answer | One answer resumes the builder. A second Enter does not. | The popup still has no input field. |
| Fallback | A question with no role is stored for the Project Manager with `fallback`. | The Developer does not see that body. |
| Other organization | That person’s lookup is not found. | The organization’s own two roles still see the app. |
| No phase walkthrough | No extra card, no phase strip, no second box. | Electron and Bolt files in this repo are untouched. |

The record is both browsers on the same app at the moment a question is open, and again on the header after the app exists. One role’s screenshot does not prove the other role’s chrome.
