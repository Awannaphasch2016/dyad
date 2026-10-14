# Run speckit-phased and show it in the Dyad window

Status: Dyad paints each bead on that bead's phase chat, and a waiting gate ends the visible stream so **Approve and continue** can be clicked. GasCity still has to execute `speckit-phased`. `gc` is not in this repo, so Dyad does not walk the beads.

## Important points

1. One `gc sling` of `speckit-phased` walks the beads. Dyad does not play the steps.
2. Each bead posts events back with its step id. Those events are the only new text.
3. The open chat is that bead's phase. The message list shows that bead's text.
4. A waiting gate stops the streaming indicator, shows the question, and enables **Approve and continue**. The click writes the verdict. It does not open the next phase.
5. The next phase stays unchanged until GasCity routes the next bead. Delivery is unfinished until publish closes.
6. The proof is the Dyad message list and phase bar beside `gc session logs`. A side page is not the proof.

## What is already true

A factory send on a host-managed app opens one workflow and POSTs:

```json
{
  "type": "sling",
  "formula": "speckit-phased",
  "appId": 1,
  "chatId": 2,
  "prompt": "...",
  "taskId": "gas-city-run:..."
}
```

An event that includes `stepId` updates `factory_host_runs.current_step_id` and appends `content` onto that step's phase chat. A new phase gets a new assistant message. The phase bar reads `closedPhases`, `openPhase`, `stepTitle`, and `gateWaiting`. **Approve and continue** posts `{ type: "verdict", verdict: "approve" }` and does not call `selectChat`.

That is the door for this run. It is not the run.

## Why the window stays blank

The message list in `ChatPanel` is `chatMessagesByIdAtom`. A row in SQLite does not update it. The live paint is `chat:response:chunk`, and `publishSession` sends that chunk for the chat that started the sling. A later bead can write Implementation in the database while the chunk still describes Discovery.

The open chat does not follow the bead. The redirect in `FactoryPhaseBar` runs when the current phase is locked. A closed Discovery chat is still unlocked, so the user remains on Discovery while Implementation text lands on the other chat.

The stream stays open until `type: "end"`. A gate (`input-required`) does not finish it. **Approve and continue** is disabled while `isStreaming` is true, so the verdict cannot be clicked while GasCity is waiting. `ChatPanel` also refuses to replace an in-progress assistant reply with a database fetch.

The question list does not poll. A clarify question inserted by the bridge stays invisible until something else refetches it.

`activity` events with text are appended the same way as `text`. The user would see a second transcript.

## The run

GasCity receives the sling Dyad already sends. The executor is `gc sling`, as [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159) froze. The packs are `speckit-phased` from [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154), with `build-base` imported from `gastownhall/gascity-packs`. The work item is the user's prompt. The method is the formula.

If `gc formula show speckit-phased` cannot list the steps, stop. Do not imitate the graph inside Dyad, and do not start `handleLocalAgentStream`.

For each ready bead the guest session executes, GasCity POSTs the host bridge:

`POST /v1/apps/:appId/phases/:phase/events`

```json
{
  "taskId": "gas-city-run:...",
  "cursor": 1,
  "type": "text",
  "content": "...",
  "stepId": "requirements"
}
```

`phase` is the step's phase. `cursor` starts at 1 and increases by one. `stepId` is required. File edits use `POST /v1/apps/:appId/tools/:toolName` and wait for the string. A clarify question uses the existing question route. A gate posts `input-required` with `accept-discovery`, `accept-implementation`, or `accept-delivery`, then waits. The verdict Dyad already posts is what writes `human_gate.verdict`. `type: "end"` is sent only after `publish` closes.

| Step                                    | Phase          | What the window shows                                      |
| --------------------------------------- | -------------- | ---------------------------------------------------------- |
| `requirements`                          | Discovery      | Specify text on Discovery                                  |
| `clarify`                               | Discovery      | The question, and no further assistant text while it waits |
| `plan`, `plan-review`, `decompose`      | Discovery      | Plan and tasks on Discovery                                |
| `accept-discovery`                      | Discovery      | The gate. Implementation stays locked                      |
| `implement` or `implement-same-session` | Implementation | Implement text on Implementation                           |
| `review`                                | Implementation | Converge text on Implementation                            |
| `accept-implementation`                 | Implementation | The gate. Delivery stays locked                            |
| `finalize`                              | Delivery       | The report on Delivery                                     |
| `accept-delivery`                       | Delivery       | The gate. Publish has not started                          |
| `publish`                               | Delivery       | Publish's result. Delivery finishes when this bead closes  |

## The paint

Dyad already has the message list and the phase bar. This plan does not add a renderer.

1. A `text` event appends to the assistant message for that step's phase. `activity` updates the cursor and does not append. `input-required` does not invent a waiting paragraph.
2. That event publishes `chat:response:chunk` for the bead's chat. The chunk schema stays the full `messages` array. The chunk is applied to `chatMessagesByIdAtom` for that chat even when the original sling stream has ended.
3. When the open bead's phase is not the selected chat, the bar selects that phase's chat. It does not prefill, and it does not send "Start Implementation."
4. An `input-required` gate sends `chat:response:end` for the visible stream and leaves the run `input-required`. The streaming indicator stops. **Approve and continue** enables. The question list refetches and shows the open question. Already written text stays. No new assistant text arrives until the next bead posts `text`.
5. The next bead's first event selects its phase and paints there. Discovery's list does not grow after the gate.

## Change impact matrix

Same rule as [PR #129](https://github.com/Awannaphasch2016/dyad/pull/129). A row is finished only when every Change cell is true and every Leave cell still behaves as it does today.

| Column       | Where it lives                                                   |
| ------------ | ---------------------------------------------------------------- |
| Message row  | `applyFactoryHostEvent` writing `messages`.                      |
| Live chunk   | `publishSession`, `chat:response:chunk`, `chatMessagesByIdAtom`. |
| Stream flag  | `FactorySession` until `end`; `isStreaming` disables Approve.    |
| Open chat    | `selectChat` in `FactoryPhaseBar`.                               |
| Questions    | `HitlQuestionList` and `factory.listQuestions`.                  |
| Phase bar    | Lock, shade, step title, and the verdict button.                 |
| Formula walk | GasCity routing `speckit-phased`. Not a Dyad loop.               |

| Intention                                        | Message row                                                                                         | Live chunk                                                       | Stream flag                                                                                       | Open chat                                                                       | Questions                                                            | Phase bar                                                                   | Formula walk                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| The message list shows the bead that is running  | Change. Only `text` appends. `activity` does not.                                                   | Change. The chunk is for the bead's chat, and the atom takes it. | Leave.                                                                                            | Change. The selected chat is the bead's phase.                                  | Leave.                                                               | Leave. The step title already reads the bead.                               | Change. GasCity posts `text` with `stepId` while the guest session runs the bead.      |
| A waiting gate can be answered                   | Change. `input-required` does not append a fake reply.                                              | Leave. No new chunk until the next bead.                         | Change. The gate ends the visible stream and leaves the run `input-required`. Approve is enabled. | Leave. The chat stays on that gate's phase.                                     | Change. The list refetches and shows the question for the open bead. | Leave. The button already posts the verdict and does not call `selectChat`. | Change. The bead waits. The verdict writes `human_gate.verdict`.                       |
| The next phase gets text only when its bead runs | Change. The new phase gets its own assistant message. The previous message stops growing.           | Change. The next chunk targets the new chat.                     | Leave.                                                                                            | Change. The bar selects the new phase when the bead arrives, without a prefill. | Leave.                                                               | Leave. The lock already waits for the closed bead.                          | Change. The `needs` edge releases the next bead. Dyad does not sling again.            |
| Delivery stays open through publish              | Change. Publish appends on the Delivery message. The run completes only on `end` after that append. | Change. Publish's chunk targets Delivery.                        | Change. `end` is the completed stream. A delivery gate is not `end`.                              | Leave. The chat stays Delivery.                                                 | Leave.                                                               | Leave. The finished shade already waits for `publish` plus `completed`.     | Change. `publish` runs after `accept-delivery`. `end` follows the closed publish bead. |

## Order

1. **Resolve the formula.** `gc formula show speckit-phased` lists the steps above. Wire the sling payload to one `gc sling`. One workflow id is the `taskId` Dyad already stored.
2. **Walk the beads.** The guest session runs the ready bead. Text, tools, questions, and gates use the routes above. `stepId` is on every event.
3. **Paint the bead's chat.** The chunk and the selected chat follow `stepId`. The atom updates. `activity` stays off the transcript.
4. **Release the gate.** `input-required` ends the visible stream, refetches the question, and enables the verdict. The next bead is what paints the next phase.
5. **Watch the window.** Use the input frozen in PR #159. Record the Dyad message list and phase bar beside `gc session logs` and the bead closures. [PR #162](https://github.com/Awannaphasch2016/dyad/pull/162) is the walk shape. The scripted videos on [PR #160](https://github.com/Awannaphasch2016/dyad/pull/160) are not this run.

## Evidence

The run counts only when all of these are true together:

- `gc session logs` shows the guest session executing the open bead, and the Dyad message list shows that bead's text on that bead's phase.
- While the gate is open, the streaming indicator is off, the question or the approve button is visible, and the next phase's message list is unchanged.
- Clicking **Approve and continue** does not add text and does not switch chats. The next phase's first text arrives with the next bead's event.
- The main-process log for the factory turn does not enter `handleLocalAgentStream`.
- Implementation's files appear because the guest session called the tool route.

## Out of scope

- A Dyad loop that pretends to be `speckit-phased`.
- A new message-list component, or a side page.
- Retiring `handleLocalAgentStream` for Ask, Build, Agent, and Plan. That remains the other plan's session slice.
- Editing formula TOML, or starting the ungated `speckit-build` run from PR #156.
- `execute_sandbox_script`, sub-agents, and MCP on the factory callback.
