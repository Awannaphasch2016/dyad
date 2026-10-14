# Session scope on the organization app

This plan does not change code. It records how the approved UI prototype becomes the Vibe SDK preview.

The prototype is the screen behavior: [Organization session prototype](https://cursor.com/canvas/store-db30c5d0-abd2-4900-b1d2-28a3ec152088/5f922de8-fca5-45ec-9b80-16ef874aa1d4).

The Vibe SDK already owns the logic. Sign-in reads the one Wewebplus membership. Create, the app list, the question poll, and the agent socket are the calls the screen already makes. This change teaches that existing screen to keep one app’s representation at a time, and to read the role from the sign-in response.

The prototype draws both accounts side by side so they can be compared. The product does not. Each account keeps its own browser. Both browsers call the same app.

## What the screen does

One organization. The header is a label, `Wewebplus · Project Manager` or `Wewebplus · Developer`. It is not a menu.

The sidebar lists that organization’s apps. The existing **New build** control returns to the home prompt, which already asks “What should we BUILD today?” Only the Project Manager’s Enter on that prompt starts an app. The Developer can open every app in the list.

Opening an app draws only that app. The question, the pending card, the completed turns, and any half-typed reply from the previous app are gone before the next poll is painted.

On one app, both roles see the same run. The named role sees the question under Orange and answers in the existing prompt box. The other role sees “Response required” and does not see the question. The answer replaces that card on both screens.

## What already does this

| Prototype piece | SDK call that already owns it |
| --- | --- |
| Header chip | Sign-in returns `organization` and `role`, then stores `Wewebplus · Project Manager` or `Wewebplus · Developer` in `sessionStorage` key `vibesdk-shared-role`. `SharedRole` draws that string. Sign-out removes it. |
| App list | `GET` the user’s apps. The list query is already `org_id` for that membership. Recent and all-apps both use that query. |
| New app | Sidebar **New build** navigates to `/`. Home `handleCreateApp` is the Enter on the existing prompt. `assertProjectManager` refuses anyone else. |
| Question, pending card, answer | `GET /api/org/question?appId=` returns `body`, `waiting`, `pending`, and `turns` for this membership and this app. The chat already draws Orange, “Response required”, and the account-name turn. |
| Shared run | One Durable Object per app. `shouldBeGenerating` still owes the run at create. `organizationHold` still keeps the question text off the other socket. |

## How to read the matrix

Same columns and same rule as [vibesdk-owed-start.md](vibesdk-owed-start.md).

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as the last live run left it.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. One usable row: `org_id` and `role_id`. Read at request time. This run does not write it. |
| Sign-in | Clerk identifies the person. The response already has `organization` and `role` (`Project Manager` or `Developer`). The browser stores one concatenated chip string. Home Enter and the sidebar currently search that string for the words “Developer” and “Project Manager.” |
| App record | Vibe SDK D1 `apps`. `org_id` is belonging. `created_by` is who pressed Enter. |
| Question record | Vibe SDK D1 `questions` and `answers`, keyed by `app_id`. |
| Agent run | One Durable Object per app, including `shouldBeGenerating` and `ask_questions`. |
| Permissions | Who may create, who may open, who receives the question body. |
| Controls | Home Enter, chat Enter, and the existing **New build** control. The prompt box has no second field. |
| Chrome | Header chip, sidebar list, Orange question, pending card, turns, and the composer text. Chat keeps `orgBody`, `orgWaiting`, `orgPending`, `orgSeenQuestion`, and `orgTurns` in React state. `/chat/new` and `/chat/:id` are the same component, so that state survives a change of app id. |
| Delivery | The shared agent socket and `GET /api/org/question?appId=` every two seconds. |
| Other products | Electron, hitl-web, Bolt, phase names, and the shared `wewebplus` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The header names the one organization and the signed-in role | Leave. | Leave. The chip string stays. Sign-out still removes it. | Leave. | Leave. | Leave. | Leave. | Leave. | Leave. The chip stays a label. | Leave. | Leave. Do not copy DYAD’s organization picker, Private account, or Create organization. |
| The sidebar is this organization’s apps | Leave. | Change. The apps heading reads the `organization` value sign-in already returned. | Leave. The list query stays `org_id`. | Leave. | Leave. | Leave. | Leave. **New build** still navigates to `/`. Do not add a second new-app control. | Change. When this session has an organization, the apps group label is that organization name. The rows stay the apps from the existing list. | Leave. | Leave. |
| Opening another app shows only that app | Leave. | Leave. The role stays with the browser. | Leave. | Leave. Rows stay keyed by `app_id`. | Leave. The next URL attaches to that app’s Durable Object. | Leave. | Change. Chat Enter follows the poll for the app id now on screen. A reply typed for the previous app is not still in the box. | Change. When the app id changes, clear `orgBody`, `orgWaiting`, `orgPending`, `orgSeenQuestion`, `orgTurns`, and the composer text before the next poll is drawn. `orgSeenQuestion` clears even when the next app has no question. | Leave. The poll URL stays `GET /api/org/question?appId=` for the id in the route. | Leave. |
| Home Enter reads the sign-in role | Leave. `role_id` stays the server authority. | Change. Store the `role` value beside the chip string. Clear it on sign-out with the chip. Home and the sidebar read this value. They stop searching the chip text. | Leave. | Leave. | Leave. | Leave. `assertProjectManager` still refuses a Developer create. | Change. Home Enter returns immediately when the stored role is `Developer`. | Leave. Both roles still open an organization app at `/chat/:id`. | Leave. | Leave. |
| Both roles keep one shared run | Leave. | Leave. | Leave. | Leave. | Leave. The owed run, `ask_questions`, and `organizationHold` stay. | Leave. The body is still returned only to the named role. | Leave. The named role still answers in the existing prompt box. | Leave. Orange, the account name, the role avatar, and “Response required” stay. | Leave. | Leave. |
| An approval is the existing answer | Leave. | Leave. | Leave. | Leave. | Leave. One answer still resumes the builder. A second answer does not. | Leave. | Leave. | Leave. | Leave. | Leave. Do not add Discovery, Implementation, or Delivery. |

## What the edit touches

The preview patch on top of `cursor/vibesdk-owed-run-0539`. It does not fork the Vibe SDK pin.

- `deploy/preview/vibesdk-shared-auth.mjs`, in the existing sign-in patch. When the response has `organization` and `role`, keep writing the chip string. Also store `role` on its own `sessionStorage` key. The logout patch removes that key with the chip string.
- `deploy/preview/vibesdk-org-run.mjs`, in `patchHome`. The Developer check reads the role key. It no longer uses `includes('Developer')` on the chip string.
- The same file, in `patchSidebar`. `/chat/:id` is chosen because the role key is `Project Manager` or `Developer`. The apps group label, when that role key is set, is the organization name from the same sign-in response.
- The same file, in `patchChat`. At the start of the effect that already depends on `urlChatId`, clear the five organization fields and the composer text. The poll for the new id is what fills them again.

Leave `assertProjectManager`, `memberCanAccessApp`, `openOrganizationQuestion`, the socket role headers, and the `generate_all` owed-start path.

## What stays as the last run left it

- Only the Project Manager’s Enter on the home prompt creates an app.
- Both roles in the organization may open the app.
- The human label is the account name. The three avatars stay.
- The question text is an Orange message for the named role. The other role sees the pending interaction and not the body.
- One answer resumes the builder. A second answer does not.
- “Waiting on the Project Manager.” is not drawn as its own bubble.
- The header does not say a person owns the app. **Private** and **Make public** stay off both screens.
- There is no second prompt box and no phase strip.
- Shared `wewebplus` is not altered.
- The prototype’s side-by-side panes are not built. Each account has its own browser.

## Important points

1. The prototype is the behavior. The Vibe SDK home prompt, sidebar, and chat stay the screens.
2. Each account has its own browser. Both call the same app through the poll and the socket that already exist.
3. Sign-in already returns the organization name and the role. The header chip stays that label. Home Enter reads the role value, not words inside the chip.
4. The app list is already the organization’s apps. **New build** remains the way back to the home prompt. The list heading shows the organization name.
5. Changing apps clears the question, the pending card, the turns, and the half-typed reply before the next poll. Questions stay stored per app.
6. The named role still sees the question and answers in the existing prompt box. The other role still sees “Response required” without the question. One answer still updates both browsers.
7. No organization switcher, no Private account, no project table, no phase approval, and no change to the owed builder start or to shared `wewebplus`.

## How to verify

| Row | Change check | Leave check |
| --- | --- | --- |
| Header label | — | Both browsers still show `Wewebplus ·` plus the signed-in role. There is no organization menu. |
| Organization list | The apps heading is Wewebplus for both roles. Both lists contain the same apps. | **New build** still opens the home prompt. A Developer on that prompt still does not create an app. |
| Another app | The unit test shows the five organization fields cleared when the app id changes, including `orgSeenQuestion` when the next payload has no body. On the live check, leave an app that has a question and open another. The second screen does not show the first question or pending card. | The poll for the second screen uses the second app id. The first app’s question row is unchanged. |
| Role value | The unit test shows home Enter comparing the stored role to `Developer`, and shows that comparison absent from the chip string. A Developer create request is still refused by the server. | Editing the chip string in the browser does not grant create. `assertProjectManager` still decides. |
| Shared run | — | The named role sees the question under Orange and can answer. The other role sees “Response required” and not the question text. One answer updates both browsers. |
| Approval is the answer | — | No phase control appears. A second answer does not resume the builder. |
