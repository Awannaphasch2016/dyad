# GasCity as orchestrator: remaining work

Status: plan. No new runtime change in this document.

## What changed, and why

Two corrections landed on the previous draft.

The first draft limited GasCity to the three phase chats and proposed a
counter-file demo. Those three names are human gates on a methodology
formula. The proof reuses `speckit-phased`.

This revision corrects the execution path. A prompt that names the
methodology is still a prompt. A formula run is GasCity compiling that
formula into beads and routing each bead to a guest session. Dyad's
native agent loop is legacy. It is not a second supported way to run an
agent.

| Earlier statement | Correction | Why |
| --- | --- | --- |
| GasCity runs only the three phase chats. | GasCity runs the whole formula, including every methodology step and every gate. | A phase chat is a view of a gate. The chapters inside the phase are formula steps. |
| Prove it by writing `src/counter.ts`. | Sling `speckit-phased` from the existing packs. | [PR #148](https://github.com/Awannaphasch2016/dyad/pull/148), [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154), [PR #156](https://github.com/Awannaphasch2016/dyad/pull/156), and [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159) already define that run. |
| A per-phase prompt is close enough if the text describes Spec Kit. | The prompt payload does not name a formula and does not create a bead graph. | Today's `type: prompt` can be followed or ignored by whoever receives it. A formula run cannot skip a `needs` edge. |
| Ask, Build, Agent, and Plan stay on `handleLocalAgentStream`. | That loop is legacy. Every agent turn runs in a GasCity guest session. | Two agent loops means two orchestrators. Dyad keeps the window, the files, and the verdict. |

## Prompt versus formula

Today a factory chat does not execute a formula. After `chat:stream:start`,
`chat_stream_handlers.ts` calls `runFactoryOrchestratedTurn` when the chat
title is Discovery, Implementation, or Delivery.
`factory_orchestrator.ts` then POSTs:

```json
{ "type": "prompt", "appId": 1, "chatId": 2, "phase": "discovery", "prompt": "...", "taskId": "gas-city-run:..." }
```

That payload is a string plus a phase name. It does not name
`speckit-phased`. GasCity does not compile a graph, open step beads, or
hold `implement` until `accept-discovery` closes. A listener can hand the
string to a model and hope the model follows Spec Kit. The model can skip
clarify, reorder tasks, or walk past a gate. Nothing in the city rejects
that. That is prompting an agent. It is not a formula run.

A genuine formula run has all four of these:

1. Dyad invokes the formula by name, once: sling `speckit-phased` with
   `artifact_root` set. The user's words are the work item. They are not
   the method.
2. GasCity compiles the formula. `gc formula show speckit-phased` shows
   the steps and the `needs` edges already checked by
   `src/lib/methodologyPacks.test.ts` in
   [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). Cook or
   sling materializes one bead per step.
3. GasCity's orchestrator routes a bead only when every bead it `needs`
   is closed. `accept-discovery` stays open until `human_gate.verdict` is
   `approve`. The implement drain cannot start before that.
4. The agent that executes a bead runs inside a GasCity guest session.
   Dyad does not call the model for that bead.

| | Prompt | Formula run |
| --- | --- | --- |
| What Dyad sends | `type: prompt` and the user's text | One sling of `speckit-phased` |
| What GasCity stores | A task id, if anything is listening | A workflow of step beads |
| Who decides the next chapter | Whoever reads the prompt | The formula's `needs` edges |
| What a skipped gate looks like | The model continues | The downstream bead stays blocked |

## Guest session

A guest session is the GasCity session that owns the agent process. Gas
City creates one when work is slung: an on-demand session by default, the
live process `gc session list` shows. The model runs there. Dyad does not
start a second one.

`FactorySession` in `factory_orchestrator.ts` is not that. It is a window
subscription: which chat should receive `chat:response:chunk`. It holds no
model call.

| Piece | Owns | Does not own |
| --- | --- | --- |
| Dyad window | Composer, message list, cancel button, gate question | The agent process, the formula graph, the next step |
| Dyad tool route | `invokeRegisteredTool` for files on this machine: schema, consent, path jail | Choosing the tool, calling the model |
| GasCity orchestrator | Compile `speckit-phased`, route ready beads, run checks, open the next step | The user's files, the pixels |
| Guest session | The agent process for one bead, or the operator session the formula targets | A private copy of the methodology, a second loop inside Dyad |

`handleLocalAgentStream` is the legacy path. It calls the model from
Electron. New turns do not enter it, including Ask, Build, Agent, and
Plan. There is no fallback when GasCity is down: the send fails in the
window. Leaving the function in the tree until its call sites are gone is
deletion work. It is not a supported execution option.

File tools stay behind the existing wrapper because the files are on the
user's machine. That wrapper is not an agent loop. GasCity decides the
call. Dyad executes the one tool and returns the string.

```mermaid
sequenceDiagram
  participant User
  participant App as Dyad window
  participant GC as GasCity orchestrator
  participant Session as Guest session
  participant Wrap as invokeRegisteredTool

  User->>App: start the factory
  App->>GC: sling speckit-phased once
  GC->>GC: compile steps into beads
  loop Each ready bead
    GC->>Session: route the bead
    Session->>Wrap: tool name and args, when the step touches files
    Wrap-->>Session: string, or a consent or path error
    Session-->>App: text for the message list
  end
  GC-->>App: Discovery gate is open
  User->>App: approve or request changes
  App->>GC: human_gate.verdict on that bead
  GC->>GC: approve releases implement
  Note over GC,Session: Implementation and Delivery follow the same session path
```

A side page that posts tool calls in a fixed order is a simulation. A
phase bar that submits the next chat is Dyad sequencing work. A prompt
that says "follow Spec Kit" is still a prompt. None of those is this
architecture.

## Where orchestration begins and ends

GasCity's job starts when Dyad slings one formula, and it ends when that
formula reaches its terminal step or stops on an open gate or an error.

For the validation run the formula is `speckit-phased` from
[PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). The guest
session executes the bead GasCity routes. It does not choose the next
row.

| Step | Kind | Who advances it |
| --- | --- | --- |
| `requirements` | Specify. Writes `spec.md`. | GasCity routes the bead. The guest session executes it. |
| `clarify` | At most five questions, only while `spec.md` contains `NEEDS CLARIFICATION`. | GasCity holds the step. Dyad shows the question and returns the answer. |
| `plan`, `plan-review`, `decompose` | Plan and tasks. | GasCity |
| `accept-discovery` | Discovery gate, after tasks and before the implement drain. | GasCity holds the bead. Dyad records `human_gate.verdict`. |
| `implement` or `implement-same-session` | Task drain. | GasCity, only after Discovery is approved. |
| `review` | Converge. | GasCity |
| `accept-implementation` | Implementation gate, after converge and before the final report. | Same split as Discovery. |
| `finalize` | Final report. | GasCity |
| `accept-delivery` | Delivery gate, after the report and before publish. | Same split as Discovery. |
| `publish` | Push or an explicit no-op. | GasCity, after the Delivery verdict is `approve`. |

`request-changes` reruns that gate's revision child. Silence leaves the
bead open. The phase changes because the formula's `needs` edge is
satisfied.

The same boundary applies to the other packs in PR #154. This validation
run slings Spec Kit only, as
[PR #159](https://github.com/Awannaphasch2016/dyad/pull/159) already froze.

A chat that is not this factory still uses a guest session. It does not
use `handleLocalAgentStream`. If that chat has no formula, GasCity still
owns the agent process. Dyad still only displays it and serves tools.

## References to reuse

Do not add a new methodology and do not script a counter module.

| Reference | Use it for |
| --- | --- |
| [PR #148](https://github.com/Awannaphasch2016/dyad/pull/148) `formulas/speckit` | `speckit-build`: specify, clarify, plan, tasks, implement, converge. Extends `build-base`. Does not run `specify workflow`. |
| [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154) `speckit-phased` | The same sequence plus the three gates. `src/lib/methodologyPacks.test.ts` checks the `needs` edges. |
| [PR #156](https://github.com/Awannaphasch2016/dyad/pull/156) | The frozen GIT Conference input. Native skills and ungated `speckit-build` stay there. This proof does not start them. |
| [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159) `plans/speckit-full-run.md` | One `gc sling` of `speckit-phased` on `Awannaphasch2016/sdd-gitcon-impl` at `baseline/speckit-1.1.2` (`a41476e8d1330c90e49eb2dacf8b729ebb3a16f5`), specification `gitcon-v1`, then AC-01 through AC-20. The executor is `gc sling`, not `experiments/sdd/bin/start-worker.mjs`. |
| [PR #146](https://github.com/Awannaphasch2016/dyad/pull/146) | The file and transcript door. Its `type: prompt` path is the legacy handoff this plan replaces for factory runs. |

Import `gascity` from `gastownhall/gascity-packs` so `extends` can resolve
`build-base`. Put this repo's `formulas/speckit` on the formula path.
If `gc` cannot resolve `speckit-phased`, stop. Do not imitate the graph
inside Dyad, and do not fall back to the native agent.

## Evidence

The run counts only when all of these are true together:

- `gc formula show speckit-phased` lists the steps above, and the workflow
  beads close in that order.
- `gc session list` shows the guest session that executed the bead, and
  `gc session logs` for that id shows the agent doing the step.
- The Dyad message list shows the same text and the gate question while
  the bead is open. The Discovery verdict is what releases `implement`.
- The main-process log for that turn does not enter
  `handleLocalAgentStream`.
- Implementation's files appear because the guest session called the tool
  route. A second prompt from the phase bar is not what started
  Implementation.

## Slices

### 1. One agent path

Stop sending new turns to `handleLocalAgentStream`. Every send opens or
continues a GasCity guest session and paints that session's replies on
the message list. Ask, Build, Agent, and Plan use this path. A missing
city fails the send. Do not keep a native fallback.

The tool route from PR #146 stays the way a guest session touches files.
Do not copy `TOOL_DEFINITIONS` into the session.

### 2. Invoke one formula

The factory starts by slinging `speckit-phased` with `artifact_root` set.
One workflow id covers the run. Dyad does not send a fresh prompt to open
Implementation or Delivery. Retire `type: prompt` as the factory handoff.

### 3. GasCity walks the existing graph

On that sling, GasCity runs the steps in the table above inside guest
sessions. File edits go through `POST /v1/apps/:appId/tools/:toolName`
and wait for the string. Text for the window goes through the event
route, cursor starting at 1. A human gate posts `input-required` and
waits. The answer writes `human_gate.verdict` on that bead. GasCity then
continues the same workflow. Cancel stops the guest session and stops
waiting on tools.

### 4. Show the real run

Use the input frozen in PR #159. Record the Dyad window beside
`gc session logs` and the bead closures.

Replace the bridge-page recording. A script that calls the tool route in
a fixed order, a phase bar that starts the next chat, or a prompt that
describes Spec Kit, is not this proof.

### 5. Keep the failures visible

| Failure | What the user sees |
| --- | --- |
| GasCity down or the guest session does not start | The send fails in the window. Dyad does not start its legacy agent. |
| `speckit-phased` does not resolve | The run stops. Dyad does not play the steps locally. |
| Consent denied or path jail | The tool route returns the error. The file is unchanged. The guest session decides the next model step. |
| Gate left unanswered | The bead stays open. The next phase does not start. |
| User cancels | The tool aborts. The transcript ends cancelled. The guest session stops. |
| Dyad quits during a tool | The route dies. GasCity keeps the workflow. The file edit does not move. |

## Out of scope

- Keeping `handleLocalAgentStream` as a supported path beside guest sessions.
- A new methodology pack, or a counter-file demonstration.
- Starting the native Spec Kit skill run or ungated `speckit-build` from PR #156.
- An MCP server for Dyad's tools.
- Editing formula TOML as the feature under proof.
- A new message-list renderer.
- File tools after the Electron process has exited.
- `execute_sandbox_script`, `spawn_agent`, and MCP tools on the factory callback.

## Important points

1. GasCity orchestrates the whole factory formula, not only the three phase chats.
2. Discovery, Implementation, and Delivery are human gates. The methodology steps inside them are beads GasCity routes.
3. A prompt that describes the methodology is not a formula run. The formula run is a sling that materializes those beads.
4. The agent process lives in a GasCity guest session. Dyad is the window, the tool route, and the verdict.
5. `handleLocalAgentStream` is legacy. New turns do not use it, and there is no native fallback.
6. The proof slings `speckit-phased` from PR #148, PR #154, and PR #159, and shows the guest session log beside the Dyad window.
