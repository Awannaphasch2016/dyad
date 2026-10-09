# Discovery summary, then a required preview

> The role walk already passes. This plan stops Implementation from opening before Discovery is finished, and it makes the built page part of the pass.

## Summary

Move to Implementation stays off until an assistant reply contains a real Discovery summary. The Project Manager answers in the existing page box until that summary appears. The browser check sends one fixed answer if the first reply is only a question, then requires the summary. After the build, the same check fails unless the preview shows the page name and the three menu items.

The preview words are a functional assertion for this one scenario. A pixel diff and a model's opinion of the layout stay out of the pass.

## Problem

Run `37980398672` typed this sentence and then clicked Move to Implementation:

> A one-page site for North Pier Fish with the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.

The reply asked whether the page name should be "North Pier Fish." It did not contain `## Discovery summary`. The check treated any assistant text as finished Discovery. The server allows that transition with no summary. The build still ran, and the preview happened to show the restaurant page.

`generated-website` stayed `unverified` because the job does not require those words. A later run can show an empty frame and still pass.

The page hint already says to approve once the Discovery summary looks right (`factoryPhase.ts`). The button does not wait for that heading. Discovery's own instructions (`factoryPhasePrompt.ts`) say to write this shape only after the page name, one sentence, and the page contents are known:

```
## Discovery summary
- **Page name:** ...
- **One sentence:** ...
- **Page contents:** ...
```

## Scope

### In scope

- Server refuses Discovery → Implementation when no stored assistant message has that summary.
- The Move to Implementation control is absent until the summary exists. The page box stays usable.
- The browser check answers at most once, with a fixed sentence, when the first reply has no summary. It then requires the summary before the click.
- After the build, the check fails unless the preview text contains the page name and the three menu items.
- Both downloads still match and still contain the typed description, the summary, and the Developer answer.

### Out of scope

- Rewriting Bolt's Discovery prompt so the model is forbidden to ask a question.
- A pixel diff, Browserbase, Stagehand, or a layout opinion as a pass gate.
- The iPhone WebContainer failure. `bolt` / `prd`. Production Clerk. Merging the pull request.

## Behavior

1. Discovery starts with an empty chat. Move to Implementation is not on the screen. The Project Manager can type. The Developer still sees "Waiting on the Project Manager."
2. The Project Manager sends the North Pier Fish sentence. The reply is stored.
3. If that reply has no Discovery summary, the Project Manager sends: `Yes. The page name is North Pier Fish.` The Developer still cannot send.
4. Move to Implementation appears only after an assistant message has all three bullets under `## Discovery summary`. A question with no heading does not count. A heading with no bullets does not count.
5. The Project Manager clicks Move to Implementation. The build request carries that summary, not only the raw first sentence.
6. The Developer answers Implementation and moves to Delivery. The Project Manager approves Delivery.
7. The preview frame's text contains `North Pier Fish`, `fish and chips`, `clam chowder`, and `iced tea`.
8. Both downloads are the same file and contain the typed sentence, the summary, and `The menu is on the page.`

If the summary never arrives, the check fails on that step and does not click Move to Implementation. If the preview frame has no document, or the four phrases are missing, the check fails. Those two failures are the fix. `visual-regression` and `agentic-ux` stay `not_run`.

## Server

`nextPhase` in `scripts/doppler/bolt-workflow.mjs` still names the next phase. A new check, used by `handleProject` before the compare-and-swap, reads the stored assistant messages. Discovery → Implementation is rejected with `403` and `The Discovery summary is not ready.` when none of those messages has the heading and the three bullets.

The heading match is the same shape `extractFactoryPhaseSummary` already uses: a markdown heading whose text is `Discovery summary`, then bullet lines. Text inside `<think>` does not count.

The generated worker in `workflow.ts` gets the same check. The button's `canTransition` is false in that case, so the control is not rendered. Hiding the button is not the only lock.

## Browser check

`WALKTHROUGH_EXPECTATIONS` gains one fixed answer: `Yes. The page name is North Pier Fish.`

`send-discovery-description` no longer passes on any assistant text. It passes when the stored summary contains the page name and the three menu items. The answer sentence is sent only when the first reply has no summary.

`generated-website` becomes `passed` or `failed` for this scenario. The phrases are literals in the verify script. They are not copied from whatever the model wrote.

## Tests

- A Discovery transition with only a question returns 403. The same transition with the three bullets returns the Implementation snapshot.
- The patch source shows the transition control only when `canTransition` is true, and the page box is still present on Discovery.
- The verify contract lists the answer sentence and the four preview phrases, and the script does not import those phrases from the model output.

## Verify

Open the preview after the job. On Discovery, before a summary exists, there is no Move to Implementation button. After the summary, the button is there. The delivered preview shows North Pier Fish and the three menu items. The job summary says `functional=passed` and `generated-website=passed`. A run that never gets a summary, or whose preview lacks one of the four phrases, is red.
