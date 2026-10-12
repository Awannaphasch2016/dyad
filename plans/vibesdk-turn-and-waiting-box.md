# Turns name the member, and waiting uses the question box

This plan does not change code. It records two intentions on top of the organization app, in the same change-impact matrix as [vibesdk-change-impact-matrix.md](vibesdk-change-impact-matrix.md). Belonging and permission stay the words in [vibesdk-belonging-and-permission.md](vibesdk-belonging-and-permission.md).

## What this is trying to do

The chat is a transcript of the people in the organization and the builder. A human turn shows that member’s name and that member’s role. Both people looking at the same app see the same label on the same turn.

The prompt that starts the app is the Project Manager’s turn. Both screens label it with the Project Manager’s name and the role name Project Manager.

When a question is open, the named role still sees the question in the existing question box and still answers in the prompt box. The other role sees that same box with a lock at the front. The text inside the locked box is “Waiting on the Project Manager.” or “Waiting on the Developer.” The question text stays out of the locked box. Enter in the prompt box still does nothing for the waiting role.

The reply is a turn in the shared transcript. After it is sent, both screens show the reply, labeled with the name and role of the person who typed it. The person who was waiting sees the reply. They still do not see the question that was asked.

The builder’s turn stays the builder. The label on that turn stays Orange.

A member who has not spoken does not get an empty turn. Their name appears on a turn when that turn is theirs: the launch prompt, or an answer.

## What the screens do today

`UserMessage` draws every human bubble with the label “You.” `AIMessage` draws the builder with the label “Orange.” “You” means whoever is looking, so the same sentence is a different person on each screen.

The launch prompt is already on both screens, and both screens call it “You.” The Project Manager’s answer is drawn only on the Project Manager’s screen, also as “You.” The Developer’s transcript keeps the waiting line and does not show that reply.

The waiting copy is a line, `data-testid="org-waiting"`. The named role’s question is the existing question box.

## How to read the matrix

Same columns and same rule as the earlier matrix.

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as it does today.

These rows reopen two cells the earlier matrix marked finished:

- “The other role waits” said the waiting line is already true. The words stay. The drawing becomes the locked question box.
- “The named role answers once” said the reply is an ordinary user message and that delivery stays as it is. The reply becomes a shared turn with the speaker’s name and role.

Every other row in the earlier matrix stays as written. Belonging, who may create, who may open, the header, one answer, fallback, another organization, and the absence of a phase strip are not reopened.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. One row per person: `org_id` and `role_id` (`project-manager` or `developer`). Read at request time. This run does not write it. |
| Sign-in | Clerk identifies the person. The browser also stores a display string, `sessionStorage` key `vibesdk-shared-role` (`Wewebplus · Project Manager` or `Wewebplus · Developer`). That string is the account signed in on this browser. |
| App record | Vibe SDK D1 `apps`. `org_id` is belonging. `created_by` is the account that used the create permission. `userId` is the builder’s copy of that account. `visibility` is the gallery flag. |
| Question record | Vibe SDK D1 `questions` and `answers`. `answers.user_id` is the account that answered. `answers.body` is the reply. One answer row per question. |
| Agent run | The Durable Object for that app: the prompt, the files, the preview, and `ask_questions`. `organizationHold` stops the question text from being broadcast as ordinary chat. |
| Permissions | Who may create, who may open, who receives the question body, and the refusal of delete and gallery changes. |
| Controls | Which Enter works. Home Enter, chat Enter. The question box has no field. |
| Chrome | What is drawn. Human bubbles, the builder bubble, the question box, and the waiting line. |
| Delivery | How the two browsers receive state. The shared agent socket, the per-socket question message, and the poll every two seconds. |
| Other products | Electron, hitl-web, Bolt, phase names, and the shared `wewebplus.apps` / `wewebplus.questions` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Waiting uses the same question box, with a lock at the front | Leave. | Leave. The signed-in role still decides which variant this browser draws. | Leave. | Leave. Same open question. The body stays on the row. | Leave. Held text is still not flushed as the question. | Leave. The waiting role still does not receive the body. | Leave. Enter still does nothing without a body. The box still has no field. | Change. The waiting line becomes that same question box. A lock is at the front of the box. The text inside is “Waiting on the Project Manager.” or “Waiting on the Developer.” The named role’s box stays unlocked and still shows the question. | Leave. The poll still returns the body to the named role and the waiting state to the other role. | Leave. |
| A human turn shows that member’s name and role on every screen | Leave. Read `role_id` for the speaker’s `user_id`. Do not write membership. | Leave. Clerk still identifies the account on this browser. `vibesdk-shared-role` stays that account’s role string. It is not the label for another member’s turn. | Leave. The launch turn’s speaker is `created_by`. Do not add a display-name column. | Leave. The answer’s speaker is `answers.user_id`. Resolve the name from Clerk and the role from membership when the turn is shown. Do not add a name or role column on `answers`. | Leave. The answer text is still the next prompt. The builder is not given a person’s name as its identity. | Leave. Who may press Enter is unchanged. | Leave. The reply is still typed in the existing prompt box. | Change. A human turn draws the speaker’s name and role name. Both screens use that same label. The launch prompt is the Project Manager’s name and Project Manager. An answer is the name and role of `answers.user_id`. | Change. The launch turn carries the speaker’s name and role to both browsers. The answer text is in the shared transcript, with that speaker’s name and role. Today the reply stays on the speaker’s screen. | Leave. Do not alter shared `wewebplus` columns. |
| The builder’s turn stays the builder | Leave. | Leave. | Leave. | Leave. | Leave. | Leave. | Leave. | Leave. The builder’s label stays Orange. | Leave. | Leave. |

## What stays as the last run left it

- The question body is returned only to the named role.
- One answer resumes the builder. A second answer does not.
- A question with no role is stored for the Project Manager.
- Another organization does not find the app.
- Only the Project Manager’s Enter on the home box creates an app.
- Both roles in the organization may open the app.
- The header does not say a person owns the app. **Private** and **Make public** stay off both screens.
- Delete and changing the gallery flag stay unavailable.
- There is no second prompt box and no phase strip.

## How to verify

| Row | Change check | Leave check |
| --- | --- | --- |
| Locked waiting box | While a question is open, the waiting role sees the question box with a lock and “Waiting on …” inside it. The named role sees the same box unlocked, with the question inside. | The waiting role’s screen does not contain the question text. Their Enter does not send. The box has no field. |
| Named human turns | The launch prompt shows the Project Manager’s name and role on both screens. After an answer, both screens show that reply labeled with the speaker’s name and role. | The other role still cannot answer. A second answer does not resume the builder. Membership rows are unchanged. |
| Builder turn | The builder’s bubbles still say Orange on both screens. | The answer text still reaches the builder as the next prompt. |
