# Discovery finishes when the agent stops asking

> The role walk already passes. This plan keeps Implementation closed while Discovery's latest reply still asks a question, and it makes the built page part of the pass.

## Summary

Move to Implementation stays off until the latest stored assistant reply asks nothing. A question is a finished turn that still needs an answer, so the Project Manager answers in the existing page box. The browser check sends up to three fixed answers, in order, while the latest reply asks a question. After the build, the same check fails unless the preview shows the page name and the three menu items.

The preview words are a functional assertion for this one scenario. A pixel diff and a model's opinion of the layout stay out of the pass.

## Problem

Three walks ran Discovery chat. All three ended on a question, and none stored `## Discovery summary`.

- Run `37900023075` moved on with no Discovery sentence. The build reply said the approved summary was missing.
- Run `37980398672` typed the North Pier Fish sentence. The reply asked whether that was the page name. The check treated any assistant text as finished Discovery.
- Run `37994560647` sent the one allowed answer, `Yes. The page name is North Pier Fish.` The next reply asked for the one sentence. The summary gate then stopped the walk.

Discovery's instructions already say to ask one missing fact at a time, and to write the summary once the page name, the sentence, and the page contents are known. The button was waiting for that heading. The model kept asking, so the heading never arrived.

## Scope

### In scope

- Server refuses Discovery → Implementation while there is no stored assistant reply, or the latest stored assistant reply asks a question.
- The Move to Implementation control is absent in that case. The page box stays usable.
- The browser check sends these fixed answers, in order, only while the latest reply asks a question:
  1. `Yes. The page name is North Pier Fish.`
  2. `Welcome to North Pier Fish.`
  3. `The page shows the restaurant name, a welcome line, and a menu of fish and chips, clam chowder, and iced tea.`
- After the build, the check fails unless the preview text contains the page name and the three menu items.
- Both downloads still match and still contain the typed description and the Developer answer.
- The build request carries a Discovery summary when one was stored. Otherwise it carries the approved user messages.

### Out of scope

- Rewriting Bolt's Discovery prompt so the model is forbidden to ask a question.
- Changing Implementation or Delivery. Those phases still move by the existing role gates.
- A pixel diff, Browserbase, Stagehand, or a layout opinion as a pass gate.
- The iPhone WebContainer failure. `bolt` / `prd`. Production Clerk. Merging the pull request.

## Behavior

1. Discovery starts with an empty chat. Move to Implementation is not on the screen. The Project Manager can type. The Developer still sees "Waiting on the Project Manager."
2. The Project Manager sends the North Pier Fish sentence. The reply is stored.
3. While that latest reply contains a question mark outside a thinking block, the Project Manager sends the next fixed answer. The Developer still cannot send.
4. Move to Implementation appears when the latest stored assistant reply asks nothing. The Project Manager still clicks it. The phase does not move by itself.
5. The build request carries the Discovery summary when the chat has one. Otherwise it carries the approved user messages.
6. The Developer answers Implementation and moves to Delivery. The Project Manager approves Delivery.
7. The preview frame's text contains `North Pier Fish`, `fish and chips`, `clam chowder`, and `iced tea`.
8. Both downloads are the same file and contain the typed sentence and `The menu is on the page.`

If a question is still the latest reply after the three fixed answers, the check fails on that step and does not click Move to Implementation. If the preview frame has no document, or the four phrases are missing, the check fails. `visual-regression` and `agentic-ux` stay `not_run`.

## Server

`nextPhase` in `scripts/doppler/bolt-workflow.mjs` still names the next phase. A new check, used by `handleProject` before the compare-and-swap, reads the latest stored assistant message. Discovery → Implementation is rejected with `403` and `Discovery still has a question.` when that message is missing or, after thinking blocks are removed, contains `?`.

An earlier summary does not open the button when a later reply asks a question. Text inside `<think>` does not count.

The generated worker in `workflow.ts` gets the same check. The button's `canTransition` is false in that case, so the control is not rendered. Hiding the button is not the only lock.

## Browser check

`WALKTHROUGH_EXPECTATIONS` keeps the page-name answer and adds the sentence and the page-contents answer.

`send-discovery-description` passes when the latest stored assistant reply asks nothing. It sends the next fixed answer only after a new questioning reply is stored.

`generated-website` is `passed` or `failed` for this scenario. The phrases are literals in the verify script. They are not copied from whatever the model wrote.

## Tests

- A Discovery transition whose latest reply asks a question returns 403. A later reply with no question returns the Implementation snapshot.
- A question that exists only inside `<think>` does not keep the button off.
- The patch source shows the transition control only when `canTransition` is true, and the page box is still present on Discovery.
- The verify contract lists the three answers and the four preview phrases, and the script does not import those phrases from the model output.

## Verify

Open the preview after the job. On Discovery, while the latest reply asks a question, there is no Move to Implementation button. After a reply that asks nothing, the button is there. The delivered preview shows North Pier Fish and the three menu items. The job summary says `functional=passed` and `generated-website=passed`. A run whose latest Discovery reply still asks a question, or whose preview lacks one of the four phrases, is red.
