# Merge the formula graph onto Dyad main

> Revised 2026-10-06. Checked against `main` at `ee860071`. The note is late when a later `main` commit changes `src/components/workflow/`, `src/lib/workflow/`, `src/pages/workflow.tsx`, `src/main/workflow_graph_service.ts`, or `src/ipc/handlers/workflow_graph_handlers.ts`.

## Status

The canvas is on `main`. [Pull request 14](https://github.com/Awannaphasch2016/dyad/pull/14) does not get merged.

The original steps below were written on 2026-10-02, when `main` was `a62ced89` and the canvas existed only as [chainforge#1](https://github.com/Awannaphasch2016/chainforge/pull/1). Those steps already happened on a different commit. This file now records that result.

## How the canvas reached main

| Commit | Date | What it is |
| --- | --- | --- |
| `5374d408` | 2026-10-02 | "Add a formula-node graph for Gas City workflows." Parent `c89d48de`. Same message and author time as pull request 14's `0ccf60b0`. The workflow files match. `0ccf60b0` is not an ancestor of `main`. |
| `83c099a0` | 2026-10-04 | "Publish the formula graph on its own Wewebplus preview." Adds the unlinked-app behavior described below. |
| `d13e0826` | 2026-10-05 | Merge of [pull request 27](https://github.com/Awannaphasch2016/dyad/pull/27) into `main`. That merge is how both commits arrived. |

[Pull request 14](https://github.com/Awannaphasch2016/dyad/pull/14) is the other copy: cherry-pick `0ccf60b0` of chainforge `d3df4bcc`, opened against `a62ced89` and later retargeted to `main`. GitHub marks it conflicting. A two-dot diff of `main` against that branch deletes the unlinked-app behavior, because the branch does not contain `83c099a0`.

## What main does

Each box on the canvas is one step in `formulas/<name>.toml`. A line from step A to step B writes `A` into `B.needs`. Save runs `gc formula show <name>` and restores the previous file if compile fails. Dragging a box writes only `formulas/<name>.layout.json`. A human approval is the same box with `type = "gate"`. Run colors come from `formulas/<name>.run.json` and are not stored in the formula. The sample recipe is `review-pipeline`: draft, revise, approve, ship. The page opens from the chat header **Workflow** button at `/workflow?appId=`.

When the app has no Gas City project, `getWorkflowGraph` returns that review pipeline in memory with `linked: false`. The page shows "This app is not linked to a Gas City project. You can move the review pipeline here. Save stays off until the app is linked." Save, layout writes, edge edits, and gate close stay off. A missing app still throws. That behavior is covered by `src/main/workflow_graph_service.test.ts` and `src/lib/workflow/formulaFiles.test.ts`.

## What is left

Nothing in the canvas. Do not rebase [pull request 14](https://github.com/Awannaphasch2016/dyad/pull/14) onto `main`, and do not merge it. Merging it would drop `linked` and the in-memory review pipeline.

This plan stays open as the record. It does not copy the canvas code.

## Original steps, now finished

1. [chainforge#1](https://github.com/Awannaphasch2016/chainforge/pull/1) stayed the source review. It was not merged into Chainforge `main`.
2. The canvas was committed on Dyad as `5374d408`, from the same change as `d3df4bcc`.
3. [Pull request 14](https://github.com/Awannaphasch2016/dyad/pull/14) is the parallel cherry-pick. [Pull request 27](https://github.com/Awannaphasch2016/dyad/pull/27) is the pull request that landed the canvas on `main`.
4. The workflow Vitest files are on `main` with the unlinked-app cases added.
5. Pull request 27 is merged. Pull request 14 is not the pull request to merge.

## Out of scope

- Rewriting Discovery, Implementation, and Delivery into formula nodes.
- Changing Chainforge's prompt-testing product.
- Replaying pull request 14's older `ChatHeader.tsx`. `main` already has the Workflow button, and that file has moved on for factory phases.

## Risks

| Risk | What to watch |
| --- | --- |
| Someone merges pull request 14 to "finish" the canvas | The canvas is already on `main`. That merge conflicts and removes the unlinked-app behavior from `83c099a0`. |
| The canvas and the phase chats are two workflow UIs | `main` has both. The Workflow button does not replace the phase chats. |
| Save depends on the `gc` binary | An app with no Gas City project does not compile. The page keeps Save off and shows the review pipeline in memory. A linked app still surfaces a compile failure from the handler. |
