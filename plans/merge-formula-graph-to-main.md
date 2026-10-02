# Merge the formula graph onto Dyad main

> Written 2026-10-02. This document is the merge plan. It does not copy the canvas code.

## Summary

The formula canvas is [Awannaphasch2016/chainforge#1](https://github.com/Awannaphasch2016/chainforge/pull/1), "Add a formula-node graph for Gas City workflows." That pull request is a draft. Its one commit is `d3df4bcc243b120dc88da2ebfed61810a212ca5f` on branch `cursor/formula-node-graph-3747`. Its base is `dyad-main`, which is Dyad `a62ced898e29d84d730e` — the current `main` of `Awannaphasch2016/dyad`.

The canvas belongs in Dyad. It was opened on the Chainforge fork because that agent could not push to `Awannaphasch2016/dyad`. Chainforge's own product is unchanged.

## What the source pull request does

Each box on the canvas is one step in `formulas/<name>.toml`. A line from step A to step B writes `A` into `B.needs`. Gas City stays the engine: save runs `gc formula show <name>` and restores the previous file if compile fails. Dragging a box writes only `formulas/<name>.layout.json`. A human approval is the same box with `type = "gate"`. Run colors come from `formulas/<name>.run.json` and are not stored in the formula. The sample recipe is `review-pipeline`: draft, revise, approve, ship. The page opens from the chat header **Workflow** button at `/workflow?appId=`.

The diff is about 2,113 additions across the React Flow page, the TOML graph translation, the IPC handlers, and 19 Vitest tests.

## Merge steps

1. Keep [chainforge#1](https://github.com/Awannaphasch2016/chainforge/pull/1) as the source review. Do not merge that pull request into Chainforge `main`.
2. On `Awannaphasch2016/dyad`, branch from `main` (`a62ced89`).
3. Cherry-pick `d3df4bcc243b120dc88da2ebfed61810a212ca5f`.
4. Open a second Dyad pull request into `main` whose body links this plan and chainforge#1. That pull request carries the canvas code.
5. Run the Vitest files under `src/lib/workflow/` on that branch before merge.
6. Merge the code pull request only after that review. This plan pull request does not perform that merge.

## Out of scope for the code merge

- The live Wewebplus branch `cursor/browser-dyad-ui-bbea` and its browser bridge, host roll-up, and fast CI.
- Rewriting Discovery, Implementation, and Delivery into formula nodes.
- Changing Chainforge's prompt-testing product.

## Risks

| Risk                                                | What to watch                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The canvas and the phase chats are two workflow UIs | The code merge adds a Workflow button. It leaves the phase chats in place.                       |
| Save depends on the `gc` binary                     | An app with no Gas City project cannot compile a formula. The handler must surface that failure. |
| `main` moves after `a62ced89`                       | Rebase the cherry-pick onto the new `main` before opening the code pull request.                 |
