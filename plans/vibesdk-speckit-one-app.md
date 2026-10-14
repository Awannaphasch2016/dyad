# One Spec Kit app, through the generated site

The next recording stays on one shop app until that app’s preview is on screen. `spec.md` is the first file. It is not the end of the walk.

Generated text appears in the chat only while a Gas City bead for this app is running. The last walk rendered Think’s own lines, including “Wrote /spec.md” and a connection repair sentence, with no bead running. Those lines stay off the transcript.

## What the last walk did

The pack was `speckit-phased`. The Project Manager started “Build a website for a neighborhood shop.” The builder wrote `spec.md` and asked one question. After that answer, the recording pressed New build and started “Build a short hours page for the shop.” Both browsers left the shop. The shop preview was never the thing the walk waited for.

That second app was the session check from [PR #158](https://github.com/Awannaphasch2016/dyad/pull/158). This recording does not repeat it. Session clearing stays in the product. This walk does not open a second chat to prove it.

The text on that walk came from the Think stream in `worker/agents/core/behaviors/think.ts`. The preview host never started a Gas City bead. [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154) already defines the Spec Kit beads. This screen reads those beads. It does not invent a second narrator.

## The one run

One organization. Two browsers. One app URL. One Gas City run of `speckit-phased` for that app.

1. The Project Manager types the shop request and presses Enter. The Developer’s Enter still does not start an app. That typed sentence stays on screen. It is not generated text.
2. The requirements bead runs and writes `spec.md`. Both roles see that file’s text while the bead is running. The walk screenshots it and stays on this chat.
3. A later bead asks one question. The named role sees that question under Orange and answers in the prompt box. The other role sees “Response required” and not the body. The question text is the text that bead produced.
4. The discovery bead asks whether to build from `spec.md`, `plan.md`, and `tasks.md`. The answer is an approval. That approval is the bead verdict, typed in the prompt box.
5. The implement bead generates the site and deploys the preview. The walk keeps waiting on this same URL until that preview frame is visible to both roles.
6. The recording ends on that shop chat. It does not press New build. It does not type a second product request.

`plan.md` and `tasks.md` appear when their beads run. The screen still does not draw Discovery, Implementation, or Delivery, and it does not print a bead id.

## What the chat renders

| On screen | When |
| --- | --- |
| The shop request and each typed answer | The person pressed Enter. |
| `spec.md`, `plan.md`, `tasks.md`, and the question body | The bead that produces that text is running. |
| The shop preview | The implement bead has deployed it. |
| Account name, avatar, “Response required” | A question bead is open. These are chrome, not generated text. |

The transcript does not gain a new generated sentence while no bead is running. Think deltas, tool chatter, “Wrote /spec.md”, “Seems we lost connection”, and a host line such as “Continue the current step” are not rendered.

## What changes

### Recording

`e2e-vibesdk/tests/two-roles.spec.js` drops the New build step and the hours-page prompt. The shop URL is the only chat either browser opens after sign-in.

The question loop no longer stops at two answers or after a short quiet period. It answers each new question until the preview frame is visible, or the time limit is reached. The Playwright limit moves up inside the existing 40-minute preview job. A stuck agent still fails the job. It does not hang it.

The success screenshot is the shop preview on the Project Manager screen and the Developer screen. `spec.md` remains in that same app. The screenshot has no Think-only sentence and no second app.

### Beads

The shop app gets one `speckit-phased` run. The producing beads are the formula steps `requirements`, `clarify`, `plan`, `decompose`, and `implement`, then the discovery confirmation bead. Each one is a Gas City bead from [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). The host starts the next bead when the current one finishes without an open question. It does not start a second Think narration to fill the gap.

An answer in the prompt box is written back as that bead’s verdict. The host does not add a generated sentence of its own.

This is not the GIT Conference sling in [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159). These beads belong to the one shop app.

### Chat feed

The preview stops broadcasting Think’s `CONVERSATION_RESPONSE` text into the organization transcript. A bead publishes its own text on that same Orange transcript and file list. `ask_questions` still opens one organization question, and the body is the bead’s question. `deploy_space` still runs only for the implement bead.

## What stays

- The pack is `speckit-phased`.
- The home prompt is the product request. There is no pack picker and no second prompt.
- Only the Project Manager’s Enter creates the app.
- One Orange question, one answer, account-name turns, and the three avatars.
- Shared `wewebplus` is not altered.

## How to verify

| Check | What passes |
| --- | --- |
| One app | The recording contains one chat URL. The hours-page prompt is absent. New build is not pressed. |
| Bead text | `spec.md` appears while the requirements bead is running. A quiet gap between beads adds no generated sentence. |
| Hidden narrator | The transcript has no “Wrote /spec.md” tool line and no connection-repair sentence. |
| Questions | Each question is the bead’s text. The other role does not see that text. |
| Generated app | The shop preview frame is visible to both roles on that same URL after the implement bead deploys. |
| Stop | The walk ends on the shop preview. It does not open another app. |
