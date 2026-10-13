# Participant avatars, and waiting that becomes the answer

This plan does not change code. It records two intentions on top of the organization app, in the same change-impact matrix as [vibesdk-change-impact-matrix.md](vibesdk-change-impact-matrix.md) and [vibesdk-turn-and-waiting-box.md](vibesdk-turn-and-waiting-box.md).

## What this is trying to do

Waiting is a state of one human interaction. It is not a line of text that stays in the transcript after the person has answered.

While a question is open, the chat shows one interaction for the person who must answer. That interaction shows their avatar, their account name, and a prominent marker that a response is required. When that person answers, the same interaction becomes the completed turn: the same avatar, the same account name, and the answer they typed. “Waiting on the Project Manager.” is gone from the transcript and from the box above the prompt. The builder’s next message continues under the completed interaction.

The chat has three participants, and each one has its own avatar.

- The Project Manager’s turns use the Project Manager avatar. The label is the account name, such as Walkthrough Project Manager.
- The Developer’s turns use the Developer avatar. The label is that account’s name.
- The builder’s turns use the builder avatar and the name Orange. When the builder asks a question, that question is a builder message on the named role’s screen.

A tool the builder runs stays a tool row inside the builder’s turn. It does not use a human avatar. A human interaction does not look like a tool row or a bold line under Orange.

The person who is waiting does not see the question text. They see the pending interaction for the person who must answer. After the answer, both screens show that completed interaction.

The visible human label stays the account name. The role chooses the avatar. The role is not written a second time after the name.

## What the screens do today

Assistant messages already use one builder mark: a black circle with the cloud glyph, and the name Orange. That includes generated text, the tool line “Asked 1 question,” and the sentence “Waiting on the Project Manager.”

Human messages use one shared orange circle. The letter inside is the first character of the account name. The Project Manager and the Developer do not have different avatar designs. The label on a human turn is already the account name.

The question text is not a builder message in the transcript. The named role sees it in the box above the prompt. The other role sees “Waiting on the Project Manager.” as an Orange line, and the same sentence again in the locked box. After the answer, a new human turn is appended under the account name. The Orange waiting line and the locked box both remain.

## How to read the matrix

Same columns and same rule as the earlier matrices.

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as it does today.

These rows reopen the drawing of the waiting line and of the human turn. They do not reopen belonging, who may create, who may open, the header, one answer, fallback, another organization, or the absence of a phase strip.

The earlier turn matrix said a human label includes the role name. The live correction stands: the label is the account name only. That label is already true. This matrix does not put the role back onto the name.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. One row per person: `org_id` and `role_id` (`project-manager` or `developer`). Read at request time. This run does not write it. |
| Sign-in | Clerk identifies the person. The browser also stores a display string, `sessionStorage` key `vibesdk-shared-role` (`Wewebplus · Project Manager` or `Wewebplus · Developer`). That string is the account signed in on this browser. |
| App record | Vibe SDK D1 `apps`. `org_id` is belonging. `created_by` is the account that used the create permission. `userId` is the builder’s copy of that account. `visibility` is the gallery flag. |
| Question record | Vibe SDK D1 `questions` and `answers`. Status is `open` or `answered`. `answers.user_id` is the account that answered. `answers.body` is the reply. One answer row per question. |
| Agent run | The Durable Object for that app: the prompt, the files, the preview, and `ask_questions`. `organizationHold` stops the question text from being broadcast as ordinary chat. |
| Permissions | Who may create, who may open, who receives the question body, and the refusal of delete and gallery changes. |
| Controls | Which Enter works. Home Enter, chat Enter. The question box has no field. |
| Chrome | What is drawn. Human turns, the builder turn, avatars, the question, and the waiting state. |
| Delivery | How the two browsers receive state. The shared agent socket, the per-socket question message, and the poll every two seconds. |
| Other products | Electron, hitl-web, Bolt, phase names, and the shared `wewebplus.apps` / `wewebplus.questions` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Waiting becomes the answer in the same interaction | Leave. | Leave. This browser’s role still decides who may answer on this screen. | Leave. | Leave. `open` and `answered` already are the two states. The reply stays `answers.body`. Do not add a display column. | Leave. The answer text is still the next prompt. Held question text is still not flushed to the other socket. | Leave. The waiting role still does not receive the question body. Their Enter still does not send. | Leave. The reply is still typed in the existing prompt box. That box still has no field. | Change. One interaction in the transcript. While the question is open it shows the waited-on person’s avatar, their account name, and a prominent response-required state. When the answer exists, that same interaction shows the avatar, the account name, and the answer. “Waiting on the Project Manager.” is not left in the transcript or in the box above the prompt. The builder’s next message continues under the completed interaction. | Leave. The poll already returns waiting versus the answer. Do not add a message type. A waiting sentence may still arrive on the socket. It is not drawn as its own bubble. | Leave. |
| The Project Manager, the Developer, and the builder each have an avatar | Leave. Read `role_id` to choose the human avatar. Do not write membership. | Leave. The header chip stays `Wewebplus · Project Manager` or `Wewebplus · Developer`. That chip is the signed-in session. It is not the avatar on a turn. | Leave. The launch speaker is still `created_by`. | Leave. The answer speaker is still `answers.user_id`. The role used for the avatar is already resolved when the turn is read. | Leave. The builder is not given a person’s name as its identity. | Leave. Who may press Enter is unchanged. | Leave. | Change. A Project Manager turn uses a Project Manager avatar. A Developer turn uses a Developer avatar. Both stop sharing one orange letter circle. The label stays the account name. The role is not appended to that name. A builder turn keeps the existing builder mark and the name Orange. A tool row stays inside the builder turn and does not use a human avatar. | Leave. A human turn already carries the speaker’s name and role. Builder messages are already assistant messages. | Leave. Do not alter shared `wewebplus` columns. |
| The builder’s question is a builder message | Leave. | Leave. | Leave. | Leave. The body stays on the question row. | Leave. `ask_questions` still publishes the question. `organizationHold` still keeps that body off the other socket. | Leave. The body is still returned only to the named role. | Leave. The named role still answers in the prompt box. | Change. On the named role’s screen the question text is a builder message: the builder avatar, the name Orange, and the question. The human interaction is under that message. “Asked 1 question” is not the question. The other role does not see the question text. They see the pending human interaction. | Leave. The poll still returns the body only to the named role. Chrome places that body in the builder message. | Leave. |

## What stays as the last run left it

- The human label is the account name. It is not “You,” and it does not repeat the role after the name.
- The question body is returned only to the named role.
- One answer resumes the builder. A second answer does not.
- A question with no role is stored for the Project Manager.
- Another organization does not find the app.
- Only the Project Manager’s Enter on the home box creates an app.
- Both roles in the organization may open the app.
- The header does not say a person owns the app. **Private** and **Make public** stay off both screens.
- Delete and changing the gallery flag stay unavailable.
- There is no second prompt box and no phase strip.
- The builder’s name on a builder message stays Orange.

## How to verify

| Row | Change check | Leave check |
| --- | --- | --- |
| Waiting becomes the answer | While the question is open, both screens show one pending interaction for the person who must answer, with that person’s avatar and account name. After the answer, that same interaction shows the answer. Neither screen still says “Waiting on the Project Manager.” | The waiting role’s Enter does not send. The prompt box has no field. The answer text still reaches the builder as the next prompt. |
| Three avatars | A Project Manager turn and a Developer turn use different avatars. A builder turn uses the builder mark and says Orange. The human label is only the account name. | The header chip still says `Wewebplus ·` plus the signed-in role. Membership rows are unchanged. |
| Builder question | The named role sees the question text under Orange, with the builder avatar, above the human interaction. | The other role’s screen does not contain the question text. The other socket still does not receive that body. |
