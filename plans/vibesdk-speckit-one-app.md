# One Spec Kit app, through the generated site

The next recording stays on one shop app until that app’s preview is on screen. `spec.md` is the first file. It is not the end of the walk.

## What the last walk did

The pack was `speckit-phased`. The Project Manager started “Build a website for a neighborhood shop.” The builder wrote `spec.md` and asked one question. After that answer, the recording pressed New build and started “Build a short hours page for the shop.” Both browsers left the shop. The shop preview was never the thing the walk waited for.

That second app was the session check from [PR #158](https://github.com/Awannaphasch2016/dyad/pull/158). This recording does not repeat it. Session clearing stays in the product. This walk does not open a second chat to prove it.

## The one run

One organization. Two browsers. One app URL for the whole recording.

1. The Project Manager types the shop request and presses Enter. The Developer’s Enter still does not start an app.
2. The builder writes `spec.md`. Both roles see it. The walk screenshots it and stays on this chat.
3. Each question that appears is answered in the prompt box by the named role. The other role sees “Response required” and not the body. The question text is whatever the agent asks.
4. A question that asks whether to build from `spec.md`, `plan.md`, and `tasks.md` is answered as an approval. That approval is what lets the builder generate the site.
5. The walk keeps waiting on this same URL until the shop preview is visible to both roles. The preview is the existing preview frame. The walk screenshots it.
6. The recording ends on that shop chat. It does not press New build. It does not type a second product request.

`plan.md` and `tasks.md` are written on the way to that preview. The screen still does not draw Discovery, Implementation, or Delivery.

## What changes

### Recording

`e2e-vibesdk/tests/two-roles.spec.js` drops the New build step and the hours-page prompt. The shop URL is the only chat either browser opens after sign-in.

The question loop no longer stops at two answers or after a short quiet period. It answers each new question until the preview frame is visible, or the time limit is reached. The Playwright limit moves up inside the existing 40-minute preview job. A stuck agent still fails the job. It does not hang it.

The success screenshot is the shop preview on the Project Manager screen and the Developer screen. `spec.md` remains visible in the file list of that same app.

### Host

A write step can finish without a question and leave the next file unwritten. Writing `spec.md` moves the step to clarify. Writing `plan.md` moves it to the tasks step. If that turn ends with no open question, the same generation continues into the next write step on this app. The screen does not show a second product request.

The continuation stops when a question is open, when `deploy_space` has run, or when a small cap of extra turns is reached. The cap is what makes a stuck model fail the walk.

`ask_questions` stays refused on a write step until that step’s file exists. `deploy_space` stays allowed only on the implement step.

## What stays

- The pack is `speckit-phased`, set by `VIBESDK_METHODOLOGY`.
- The home prompt is the product request. There is no pack picker and no second prompt.
- Only the Project Manager’s Enter creates the app.
- One Orange question, one answer, account-name turns, and the three avatars.
- Shared `wewebplus` is not altered. Gas City is not slung. The GIT Conference run in [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159) does not start.

## How to verify

| Check | What passes |
| --- | --- |
| One app | The recording contains one chat URL. The hours-page prompt is absent. New build is not pressed. |
| Specification | `spec.md` is visible before the preview. |
| Questions | Each question is answered from the text that appeared. The other role does not see that text. |
| Generated app | The shop preview frame is visible to both roles on that same URL. |
| Stop | The walk ends on the shop preview. It does not open another app. |
