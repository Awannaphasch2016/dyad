# Spec-driven development on the Vibe SDK screen

This plan does not change code. It records how one Spec Kit run appears in the Vibe SDK UI that the last live walkthrough already uses.

The formula is the order of work. The screen stays the screen that is already there.

## Reference

| What | Where |
| --- | --- |
| Spec Kit command order | [PR #148](https://github.com/Awannaphasch2016/dyad/pull/148). `speckit-build` writes `spec.md`, asks while that file still contains `NEEDS CLARIFICATION`, then writes `plan.md` and `tasks.md`, then implements, then converges. At most five clarify questions. It does not run `specify workflow`. |
| The human cut before implementation | [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). `speckit-phased` holds after tasks and before the implement drain. The formula mails `human` and does not name a project manager or a developer. |
| The unrun Gas City sling | [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159). That plan slings `speckit-phased` on the GIT Conference repository. It is a different executor. This plan does not start it. |
| The screen this run uses | [PR #158](https://github.com/Awannaphasch2016/dyad/pull/158). Home prompt, sidebar, chat, Orange question, pending card, and the owed builder start. |

## What the person sees

One organization. Two browsers. One app. The existing prompt box is the only place anyone types.

1. The Project Manager types what to build and presses Enter on the home prompt. That still creates the organization app. The Developer’s Enter still does not.
2. The builder writes the specification first. Both roles see that specification in the chat, and the file `spec.md` is in the app. No product preview yet.
3. If something in the specification is unresolved, the builder asks one question. A requirements question goes to the Project Manager. A technical question goes to the Developer. The named role sees it under Orange and answers in the prompt box. The other role sees “Response required” and does not see the question. At most five of these. Each answer is written back into `spec.md`.
4. The builder then writes the plan and the tasks. Both roles see `plan.md` and `tasks.md` in the chat and in the files. Spec Kit does not stop between the plan and the tasks, so this screen does not stop there either.
5. The builder asks the Project Manager one question: whether to build from those three files. That question is an Orange message. The answer is typed in the prompt box. There is no phase button and the screen does not say Discovery, Implementation, or Delivery.
6. After that answer, the builder implements the tasks and deploys the preview the way it already does. Both roles see the same files and the same preview.
7. The builder compares the preview with the specification. A product gap becomes one question to the Project Manager. A technical gap becomes one question to the Developer, or a fix the builder makes itself when the specification already decides it. When the preview matches the specification, the builder stops.

The question text is whatever the agent asks. The check reads the question that appeared. It does not memorize a sentence.

## What already does this

| Piece | What stays |
| --- | --- |
| Start | Home Enter, `assertProjectManager`, and `shouldBeGenerating`. The first socket still sends `generate_all` so the agent wakes. |
| One question | `ask_questions` with one `targetRole`. `GET /api/org/question?appId=` still returns the body only to the named role. |
| Reply | Chat Enter on the existing prompt box. One answer resumes the agent. A second answer does not. |
| Shared run | One Durable Object per app. Both browsers poll the same app. Switching apps still clears the question, the pending card, the turns, and the composer. |
| Files and preview | `deploy_space` and `get_browser_console_logs` after the build answer. |

## How to read the matrix

Same columns and same rule as [vibesdk-session-scope.md](vibesdk-session-scope.md).

A cell is either:

- **Change** — this intention is not finished until this dimension is edited as the cell says.
- **Leave** — while doing this intention, do not edit this dimension. Its current behavior stays.

A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as the last live run left it.

### The columns

| Column | Where it lives in this preview |
| --- | --- |
| Membership | `wewebplus.memberships`. Read at request time. This run does not write it. |
| Sign-in | Clerk. The chip string and the role key from the last run. |
| App record | Vibe SDK D1 `apps`. `org_id` is belonging. `created_by` is who pressed Enter. |
| Question record | Vibe SDK D1 `questions` and `answers`, keyed by `app_id`. |
| Agent run | One Durable Object per app, including `shouldBeGenerating`, `ask_questions`, and the file tools. |
| Permissions | Who may create, who may open, who receives the question body. |
| Controls | Home Enter, chat Enter, and **New build**. The prompt box has no second field. |
| Chrome | Header chip, sidebar, Orange question, pending card, turns, assistant text, files, and preview. |
| Delivery | The agent socket and `GET /api/org/question?appId=` every two seconds. |
| Other products | Electron, Gas City, hitl-web, Bolt, phase names, and the shared `wewebplus` columns. |

## Change impact matrix

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The first turns write the specification, the plan, and the tasks | Leave. | Leave. | Leave. | Leave. | Change. The builder instructions in `buildSystemPrompt` follow the Spec Kit order: `spec.md`, then clarify, then `plan.md`, then `tasks.md`. Product files and `deploy_space` are not the first turn. `generate_all` still wakes the agent. | Leave. | Leave. | Change. Both roles see those three files as assistant messages. The file list shows the same files. | Leave. The messages go to both sockets. `organizationHold` stays limited to `ask_questions`. | Leave. Do not sling `speckit-phased` and do not import Gas City into the worker. |
| An unresolved specification asks one role | Leave. | Leave. | Leave. | Change. Add `purpose` on the Vibe SDK `questions` table this preview already creates. A clarify row stores `clarify`. | Change. `ask_questions` accepts `purpose`. At most five `clarify` rows for one app. The answer is written into `spec.md`. | Leave. Requirements still go to the Project Manager. Technical questions still go to the Developer. An unnamed role still falls back to the Project Manager. | Leave. The named role still answers in the prompt box. | Leave. Orange, the account name, and “Response required” stay. | Leave. | Leave. Do not add the column to `wewebplus.questions`. |
| Building waits for the Project Manager’s answer | Leave. | Leave. | Leave. | Change. The question asked after `tasks.md` exists stores `purpose` `build` and `target_role_id` `project-manager`. | Change. The file tools refuse every path except `spec.md`, `plan.md`, and `tasks.md` until that `build` row is answered. `deploy_space` is refused in that same window. | Leave. A Developer answer does not open the window. | Leave. The answer is chat Enter. There is no new button. | Leave. The question is an Orange message. The screen does not draw a phase name. | Leave. | Leave. Do not add Discovery, Implementation, or Delivery. |
| After that answer, the existing build and preview run | Leave. | Leave. | Leave. | Leave. One answer still resumes once. | Change. The instructions then implement `tasks.md`, call `deploy_space`, and check the preview against `spec.md`. | Leave. | Leave. | Leave. Both roles see the preview the current chat already shows. | Leave. | Leave. |
| A gap found after the preview is one question or a fix | Leave. | Leave. | Leave. | Leave. A new gap uses `purpose` `clarify` and the same one-open-question rule. | Change. The converge pass may edit files when the specification already decides the point. It asks only when a person must choose. | Leave. | Leave. | Leave. | Leave. | Leave. |

## What the edit touches

The preview patch on top of `cursor/vibesdk-session-scope-run-0539`. It does not fork the Vibe SDK pin and it does not start the GIT Conference sling.

- `worker/agents/core/behaviors/think.ts`, through the existing `patchThink` in `deploy/preview/vibesdk-org-run.mjs`. Replace the “Clarify before building” block with the Spec Kit order above. Keep the deploy-and-verify block for the turns after the build answer.
- The `ask_questions` tool schema, in the same preview patch. Add `purpose` with values `clarify` and `build`.
- The Vibe SDK D1 `questions` insert this preview already runs. Store `purpose`. A missing value is stored as `clarify`.
- The file-tool and `deploy_space` handlers. Before a answered `build` question, allow writes only to `spec.md`, `plan.md`, and `tasks.md`.

Leave `assertProjectManager`, the role key, the apps heading, the app-switch clear, the avatars, the account-name labels, and `shouldBeGenerating`.

## What stays as the last run left it

- Only the Project Manager’s Enter on the home prompt creates an app.
- Both roles may open the app. The organization owns it. `created_by` does not confer belonging.
- The human label is the account name. The three avatars stay.
- The other role does not see the question body.
- One answer resumes the builder. A second answer does not.
- Switching apps clears that screen before the next poll.
- The header chip stays `Wewebplus ·` plus the signed-in role.
- There is no second prompt, no phase strip, and no phase-approval button.
- Shared `wewebplus` is not altered. Gas City, Electron, hitl-web, and Bolt stay where they are.

## Important points

1. Spec-driven development here is the Spec Kit order from PR #148: specification, clarify, plan, tasks, implement, converge.
2. That order runs inside the Vibe SDK chat. The home prompt, the Orange question, and the prompt-box reply stay the only interaction.
3. Both roles see `spec.md`, `plan.md`, and `tasks.md` before any product preview.
4. Clarify stays one question at a time, at most five, routed by the role that already answers. The named role replies in the prompt box.
5. The cut before implementation is one Project Manager question after the tasks exist. The answer is the approval. The screen does not gain a Discovery, Implementation, or Delivery control.
6. Until that answer is stored, the agent may write only the three spec files. `deploy_space` stays refused. `generate_all` still wakes the agent.
7. After the answer, the builder implements, deploys, and checks the preview against the specification. A later gap is another question or a fix, not a new stage.
8. The Gas City sling in PR #159 is a separate run. This plan does not import Gas City, does not alter `wewebplus`, and does not change who may press Enter.

## How to verify

An agent drives both browsers. It does not memorize the question. It reads the text that appeared and types the reply in the prompt box.

| Check | What passes |
| --- | --- |
| Start | The Project Manager’s Enter creates the app. The Developer’s Enter on the home prompt does not. |
| Specification first | Both chats show the specification before the preview has a product page. `spec.md` is in the files. `deploy_space` has not run. |
| Clarify | If a question appears before the tasks, only the named role sees the body. The other role sees “Response required.” One reply updates `spec.md`. A sixth clarify question is not opened. |
| Plan and tasks | Both chats show `plan.md` and `tasks.md` with no extra stop between them. |
| Build question | After the tasks, the Project Manager sees one Orange question and can answer it in the prompt box. The Developer does not see that body. No phase control is on either screen. |
| Preview | After that answer, both roles see the same preview. The Developer’s home Enter still creates nothing. |
| Another app | Opening a second app does not show the first app’s specification or question. |
