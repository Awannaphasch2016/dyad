# Dyad agent architecture and GasCity reuse

Status: investigation only. No runtime change.

This separates what the code does today from what a GasCity integration
would have to add. The question is whether GasCity can choose the agent
while Dyad's existing chat UI shows the live work.

## 1. Current architecture

Dyad does not have a small agent interface that a second runtime can
implement. The user-facing "agent" is the local-agent chat mode, and that
mode is a main-process loop around the Vercel AI SDK.

```text
Composer
  -> renderer chat-stream facade
  -> IPC chat:stream
  -> chat actor (one owner per chat)
  -> local_agent_handler
  -> streamText(model, tools, messages)
  -> tool execute() in the Electron main process
  -> chat:response:chunk
  -> message list renders XML inside the assistant message
```

Verified files:

| Piece | File |
| --- | --- |
| Renderer submit/cancel surface | `src/chat_stream/renderer_facade.ts` |
| Wire names | `src/chat_stream/protocol.ts` |
| Chunk schema | `src/ipc/types/chat.ts` (`ChatResponseChunkSchema`) |
| IPC entry | `src/ipc/handlers/chat_stream_handlers.ts` (`chat:stream`) |
| Local-agent loop | `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` |
| Tool table | `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts` |
| Tool consent and mutation tracking | `src/pro/main/ipc/handlers/local_agent/tools/tool_invocation.ts` |
| Path jail | `src/pro/main/ipc/handlers/local_agent/tools/path_safety.ts` |
| GasCity host bridge | `src/main/factory_host_bridge_server.ts`, `src/main/factory_host_service.ts` |

The model decides when to call a tool. Dyad does not have a separate
planner that picks tools. `streamText` receives `tools: allTools`. The SDK
emits `tool-input-*` and `tool-call` parts. Dyad's `execute` wrapper runs
the matching tool, returns the result to the model, and also folds an XML
rendering of that call into the assistant message the UI already knows how
to paint.

Chat modes (Ask, Build, Agent, Plan) change which tools and prompts are
legal. They are not separate agent products. Factory runs force
`requestedChatMode: "local-agent"`.

## 2. Execution sequence

```mermaid
sequenceDiagram
  participant UI as Composer
  participant R as Renderer facade
  participant IPC as chat:stream
  participant Actor as Chat actor
  participant LA as local_agent_handler
  participant Model as Model provider
  participant Tool as Tool execute
  participant DB as SQLite messages

  UI->>R: submit(prompt, chatId, mode)
  R->>IPC: invoke chat:stream
  IPC->>Actor: admit one turn for this chat
  Actor->>DB: persist user message
  Actor->>LA: run local agent
  LA->>LA: build system prompt and tool set
  LA->>Model: streamText
  loop tokens and tool calls
    Model-->>LA: text-delta or tool-call
    LA->>DB: update assistant message
    LA-->>UI: chat:response:chunk
    alt tool call
      LA->>Tool: execute(args, ctx)
      Tool-->>LA: result
      LA->>Model: tool result
    end
  end
  LA-->>UI: chat:response:end
  Actor->>Actor: release chat, drain queue
```

Cancellation is an abort on that chat's stream. The end event can carry
`wasCancelled`. Errors use `chat:response:error`. A chat has one active
owner; a second prompt queues. History lives in the Dyad message table.
The model transcript is rebuilt from that history, then sanitized so tool
calls and tool results stay paired.

## 3. Tool capability matrix

`TOOL_DEFINITIONS` is the harness. The model cannot do these things by
itself. Each tool is a function in the Electron main process with the app
path, database, and consent context.

| Capability | Tool names | Boundary |
| --- | --- | --- |
| Read and search the app | `read_file`, `list_files`, `grep`, `code_search`, `explore_code` | Paths must stay inside the app directory |
| Edit the app | `write_file`, `search_replace`, `copy_file`, `delete_file`, `rename_file` | Consent plus mutation tracking |
| Dependencies and app process | `add_dependency`, `restart_app`, `reinstall_and_restart_app` | Uses Dyad's app runtime, not a free shell |
| Checks | `run_type_checks`, `run_tests`, `run_build`, `run_pre_commit` | Bounded commands for the app, not an open terminal |
| Script | `execute_sandbox_script` | Sandbox script, not arbitrary host shell |
| Git | `git_status`, `git_diff`, `git_log`, `git_show_commit`, `git_show_file`, `git_restore_file` | App repo only |
| Data | `execute_sql`, `get_database_table_schema`, `get_supabase_project_info`, `get_neon_project_info` | Connected project, SQL consent |
| Web | `web_search`, `web_crawl`, `web_fetch` | Provider-backed fetch, not a browser the user drives |
| Images | `generate_image` | Provider image API |
| Sub-agents | `spawn_agent`, `list_agents`, `wait_agents`, `cancel_agent`, `send_message`, `followup_task` | Child Dyad agents, same harness |
| Plan / blueprint | `planning_questionnaire`, `write_plan`, `exit_plan`, `write_app_blueprint` | Plan mode and app-create flow |
| MCP | `search_mcp_tools`, `get_mcp_tool_schema`, dynamic MCP tools | User-configured MCP servers |
| Other | `read_logs`, `read_guide`, `update_todos`, `set_chat_summary`, `add_integration`, `enable_nitro`, `suggest_plugin`, chat search/read | Dyad product surfaces |

What this agent cannot do:

- It has no generic "run this shell command" tool.
- It cannot see or edit files outside the app path, except referenced-app
  reads that the tool explicitly allows.
- It cannot attach an arbitrary external agent loop. Sub-agents are more
  Dyad agents.
- It does not speak to GasCity. GasCity speaks to Dyad through the host
  bridge, and the bridge starts this same loop.

## 4. Interface inventory

| From | To | Mechanism | Reusable by GasCity? |
| --- | --- | --- | --- |
| UI | main | Electron IPC `chat:stream` | Only from inside the app |
| Main | UI | `chat:response:chunk`, `end`, `error` | Yes, if some main-process code emits the same payloads |
| Agent | model | AI SDK `streamText` over HTTPS | No. That is one model client |
| Agent | tools | In-process `execute(args, ctx)` | No. Tools expect `AgentContext` |
| Tools | disk / git / app runtime | Direct function calls | The tools can be called by Dyad. An outside process cannot call them unless a bridge wraps them |
| Tools | DB | Drizzle, same message rows the UI reads | The rows are the durable UI state |
| GasCity | Dyad | HTTP `127.0.0.1:32100` | Already exists: start run, append message, question, approval |
| Dyad | GasCity | Supervisor HTTP for formula source | Formula config only. Not agent streaming |

Internal details that should stay internal: `AgentContext`, tool execute
signatures, and the AI SDK part stream (`text-delta`, `tool-call`).

The surface that is already a protocol: `ChatResponseChunk`.

## 5. Streaming architecture

There are two streams. They are not the same thing.

**Model stream.** `streamText(...).fullStream` yields AI SDK parts:
`text-delta`, `reasoning-delta`, `tool-input-start`, `tool-call`,
`tool-result`, `finish`. Only `local_agent_handler` understands these.

**UI stream.** The handler turns those parts into text inside one
assistant message, then sends:

```ts
{
  chatId: number
  messages?: Message[]          // full snapshot when needed
  streamingMessageId?: number
  streamingPatch?: {            // replace the tail from offset
    offset: number
    content: string
    prefixHash?: number
  }
  streamingPreview?: {          // live tool-args XML, not message content
    content: string
  }
}
```

Wire names in `src/chat_stream/protocol.ts`:

- invoke: `chat:stream`
- start: `chat:stream:start`
- chunk: `chat:response:chunk`
- end: `chat:response:end`
- error: `chat:response:error`
- transport end: `chat:stream:end`

Reasoning becomes `<think>...</think>`. Tool activity becomes Dyad XML
tags in `message.content`. The renderer does not receive a typed
"tool started" event. It parses the message text it already renders for
a normal chat.

The host bridge's `POST .../messages` writes a finished message. It does
not emit `streamingPatch`. A GasCity agent that only appends messages
appears as completed bubbles, not as a live agent turn.

## 6. Integration architecture

Feasible reuse is the UI stream, not the agent class.

A GasCity-managed agent can show up in the current UI if some Dyad
main-process adapter:

1. Owns the chat turn the same way `chat:stream` does (one owner, a
   streaming assistant row, cancel, end).
2. Accepts GasCity events.
3. Translates them into `chat:response:chunk` patches and the same XML
   the message list already renders.
4. Writes the final row to the message table.

GasCity keeps its own tools and runtime. Dyad does not need those tool
calls to be `TOOL_DEFINITIONS`. It only needs a text or XML rendering.
Unknown tags would show as plain text. Tags the UI already understands
(file edits, status, questions) would light up existing cards.

The factory bridge is the place to add that translation. It already
authenticates GasCity and already knows `appId`, phase, and chat.

## 7. Before and after

```mermaid
sequenceDiagram
  participant User
  participant Dyad
  participant Model

  User->>Dyad: prompt
  Dyad->>Model: streamText + Dyad tools
  Model-->>Dyad: tokens and tool calls
  Dyad-->>User: chat:response:chunk
```

```mermaid
sequenceDiagram
  participant User
  participant Dyad as Dyad UI and adapter
  participant GC as GasCity
  participant Agent as Selected agent

  User->>Dyad: prompt
  Dyad->>GC: start turn
  GC->>Agent: run with that agent's tools
  Agent-->>GC: text, tool, status, error
  GC-->>Dyad: those events
  Dyad-->>User: same chat:response:chunk path
  GC->>Agent: may switch agent
  Agent-->>Dyad: next events, same chat
```

Switching agents does not require a second UI. It requires the events to
keep targeting the same `chatId` and streaming message.

## 8. Impact matrix

| Component | Change? |
| --- | --- |
| Composer and message list | Unchanged if chunks and XML stay the same |
| `ChatResponseChunk` schema | Unchanged for text and known XML. A new field only if we want typed tool cards for unknown agents |
| `local_agent_handler` and `TOOL_DEFINITIONS` | Unchanged. Native mode keeps working |
| Chat actor owner / cancel / queue | Small change so an external turn can hold the same lock |
| Host bridge | New event ingress, mapped to chunks |
| GasCity | New emitter. Dyad cannot invent GasCity's event format from this repo |
| Message table | Same rows. External turns must still persist there or reload loses them |
| Formula TOML | Unchanged. It picks steps, not this stream |

## 9. Options and recommendation

**Option A — GasCity orchestrates, Dyad agent still executes.** This is
the bridge today: `POST /runs` starts local-agent. GasCity can sequence
work, but it cannot put a different agent's tools or token stream in the
UI. Lowest risk, does not meet the goal.

**Option B — Pluggable agent backend inside Dyad.** Replace
`local_agent_handler` with an interface both the native loop and a
GasCity client implement. Clean in theory. High blast radius: prompts,
tools, consent, cancel, and retries all live inside that handler.

**Option C — GasCity owns execution, Dyad is only UI.** Native agent
becomes a GasCity agent too. That rewrites the primary path and makes
ordinary chat depend on the supervisor. Too large for the goal.

**Option D — Shared UI events, separate executors.** Native mode stays.
GasCity agents publish events. A Dyad adapter renders them through
`chat:response:chunk`. Executors stay different; the picture in the
window is the same.

**Recommendation: Option D.** Add an adapter on the host bridge. Do not
abstract the AI SDK loop. Do not make GasCity a required backend for
normal chat.

The adapter contract can be small:

- `turn-start` — create the streaming assistant row and take the chat lock
- `text` — append or patch message text
- `activity` — XML or status the current cards understand
- `message` — commit a bubble (the current append-message route)
- `turn-end` / `turn-error` / `cancel` — same end and error events the UI
  already handles

Until GasCity emits those, the UI can only show finished messages from
`POST /messages` and native local-agent runs from `POST /runs`.

## 10. Diagrams: current, B, C, and D

The current diagrams name the code that exists. The B, C, and D diagrams
are proposed layouts on top of that code. Same names mean the same box.

| Name in the diagrams | Code today |
| --- | --- |
| Renderer facade | `src/chat_stream/renderer_facade.ts` |
| `chat:stream` handler | `src/ipc/handlers/chat_stream_handlers.ts` |
| Chat stream host | `src/chat_stream/` host state machine, one owner per chat |
| Local agent | `handleLocalAgentStream` in `local_agent_handler.ts` |
| Tool harness | `TOOL_DEFINITIONS` |
| Host bridge | `factory_host_bridge_server.ts` on `127.0.0.1:32100` |
| Chunk | `chat:response:chunk` (`ChatResponseChunkSchema`) |

### Container diagram — current

GasCity can start the local agent or append a finished message. The model
call and the tools stay inside Dyad.

```mermaid
flowchart TB
  user["User"]

  subgraph electron ["Dyad Electron"]
    renderer["Renderer<br/>composer and message list"]
    main["Main process<br/>chat stream host, local agent, tools, host bridge"]
    db[("SQLite")]
    workspace["App workspace<br/>files, git, preview"]
  end

  model["Model provider"]
  gascity["GasCity supervisor"]
  mcp["MCP servers"]

  user --> renderer
  renderer -->|"IPC chat:stream"| main
  main -->|"IPC chat:response:chunk"| renderer
  main --> db
  main --> workspace
  main -->|"streamText"| model
  main --> mcp
  gascity -->|"HTTP POST /runs or /messages"| main
  main -->|"formula GET and PUT"| gascity
```

### Container diagram — B, pluggable backend

The renderer and the chunk IPC stay. The chat stream host no longer calls
the local agent directly. It calls an `AgentBackend`. The native backend
wraps today's loop. A second backend delegates the turn to GasCity.
A remote agent that edits the app needs a workspace callback, because the
files are on the user's machine.

```mermaid
flowchart TB
  user["User"]

  subgraph electron ["Dyad Electron"]
    renderer["Renderer<br/>unchanged"]
    host["Chat stream host<br/>selects AgentBackend"]
    native["Native backend<br/>wraps today's local agent"]
    remote["GasCity backend<br/>new"]
    db[("SQLite")]
    workspace["App workspace"]
    callback["Workspace callback<br/>new, for remote edits"]
  end

  model["Model provider"]
  gascity["GasCity<br/>foreign agent runtime"]
  mcp["MCP servers"]

  user --> renderer
  renderer -->|"chat:stream"| host
  host --> native
  host --> remote
  host --> db
  host -->|"chat:response:chunk"| renderer
  native --> workspace
  native --> model
  native --> mcp
  remote -->|"run this turn"| gascity
  gascity -.->|"file and preview calls"| callback
  callback --> workspace
```

### Container diagram — C, GasCity executes every turn

Ordinary chat leaves Dyad. GasCity hosts the old Dyad agent and every
other agent. Dyad's main process keeps the UI, the message rows, and a
tool service for the local workspace. The model provider sits behind
GasCity.

```mermaid
flowchart TB
  user["User"]

  subgraph electron ["Dyad Electron"]
    renderer["Renderer<br/>unchanged"]
    thin["Thin main<br/>turn client, chunk writer, messages"]
    tools["Workspace tool service<br/>files, git, preview, SQL"]
    db[("SQLite")]
    workspace["App workspace"]
  end

  subgraph gc ["GasCity"]
    router["Agent router"]
    moved["Dyad agent<br/>moved here"]
    other["Other agents"]
  end

  model["Model provider"]

  user --> renderer
  renderer -->|"chat:stream"| thin
  thin -->|"every prompt"| router
  router --> moved
  router --> other
  moved --> model
  other --> model
  moved -->|"tool callback"| tools
  other -->|"tool callback"| tools
  tools --> workspace
  thin --> db
  thin -->|"chat:response:chunk"| renderer
```

### Container diagram — D, shared chunks, separate executors

The native boxes stay where they are. GasCity is a second producer of
the same chunk IPC. It does not sit on the native prompt path.

```mermaid
flowchart TB
  user["User"]

  subgraph electron ["Dyad Electron"]
    renderer["Renderer<br/>unchanged"]
    host["Chat stream host<br/>unchanged for a native turn"]
    agent["Local agent and tool harness<br/>unchanged"]
    adapter["Host-bridge event adapter<br/>new"]
    db[("SQLite")]
    workspace["App workspace"]
  end

  model["Model provider"]
  gascity["GasCity<br/>other agents and their own tools"]
  mcp["MCP servers"]

  user --> renderer
  renderer -->|"native prompt"| host
  host --> agent
  agent -->|"streamText"| model
  agent --> workspace
  agent --> mcp
  agent --> db
  host -->|"chat:response:chunk"| renderer
  gascity -->|"turn events"| adapter
  adapter --> db
  adapter -->|"same chat:response:chunk"| renderer
  gascity -.->|"only if that agent edits the app"| workspace
```

### Component diagram — current

```mermaid
flowchart TB
  subgraph renderer ["Renderer"]
    composer["Composer"]
    facade["Renderer facade<br/>StreamRequest"]
    list["Message list<br/>paints message XML"]
  end

  subgraph main ["Main process"]
    ipc["chat:stream handler"]
    streamhost["Chat stream host<br/>one owner, queue, cancel"]
    local["handleLocalAgentStream"]
    sdk["streamText"]
    tools["TOOL_DEFINITIONS<br/>consent and path jail"]
    bridge["Host bridge<br/>POST /runs and /messages"]
    store["Message store"]
  end

  composer --> facade --> ipc --> streamhost
  streamhost --> local --> sdk
  local --> tools
  local --> store
  bridge -->|"starts a local-agent turn"| streamhost
  bridge -->|"appends a finished row"| store
  local -->|"chunks"| list
```

### Component diagram — B

`handleLocalAgentStream` moves behind one implementation. A mapper shared
by both backends is what the message list hears.

```mermaid
flowchart TB
  subgraph renderer ["Renderer, unchanged"]
    composer["Composer"]
    facade["Renderer facade"]
    list["Message list"]
  end

  subgraph main ["Main process"]
    ipc["chat:stream handler"]
    streamhost["Chat stream host"]
    backend["AgentBackend<br/>new interface"]
    native["NativeAgentBackend"]
    remote["GasCityAgentBackend<br/>new"]
    local["handleLocalAgentStream<br/>wrapped"]
    tools["TOOL_DEFINITIONS<br/>native backend only"]
    mapper["Chunk mapper<br/>new, shared"]
    store["Message store"]
  end

  gascity["GasCity agent runtime"]

  composer --> facade --> ipc --> streamhost --> backend
  backend --> native --> local --> tools
  backend --> remote --> gascity
  native --> mapper
  remote --> mapper
  mapper --> store
  mapper -->|"chat:response:chunk"| list
```

### Component diagram — C

The local-agent function is no longer a component of Dyad's main process.
The tools it used become a service GasCity calls back into.

```mermaid
flowchart TB
  subgraph renderer ["Renderer, unchanged"]
    composer["Composer"]
    facade["Renderer facade"]
    list["Message list"]
  end

  subgraph main ["Thin main"]
    ipc["chat:stream handler"]
    client["GasCity turn client<br/>replaces the chat stream host's executor"]
    writer["Chunk writer"]
    api["Workspace tool API<br/>files, git, preview, SQL"]
    store["Message store"]
  end

  subgraph gc ["GasCity"]
    router["Agent router"]
    moved["Dyad agent worker<br/>old loop, new home"]
    other["Other agent workers"]
  end

  composer --> facade --> ipc --> client --> router
  router --> moved
  router --> other
  moved -->|"tool callback"| api
  other -->|"tool callback"| api
  router -->|"events"| writer
  writer --> store
  writer -->|"chat:response:chunk"| list
```

### Component diagram — D

The left column is the current component diagram. The adapter is a new
sibling of the host bridge. It writes chunks and message rows. It does
not call `streamText` or `TOOL_DEFINITIONS`.

```mermaid
flowchart TB
  subgraph renderer ["Renderer, unchanged"]
    composer["Composer"]
    facade["Renderer facade"]
    list["Message list"]
  end

  subgraph main ["Main process"]
    ipc["chat:stream handler<br/>unchanged"]
    streamhost["Chat stream host<br/>unchanged"]
    local["handleLocalAgentStream<br/>unchanged"]
    tools["TOOL_DEFINITIONS<br/>unchanged"]
    bridge["Host bridge<br/>existing /runs and /messages"]
    adapter["Event adapter<br/>new"]
    store["Message store"]
  end

  gascity["GasCity agents"]

  composer --> facade --> ipc --> streamhost --> local --> tools
  local -->|"native chunks"| list
  local --> store
  bridge --> streamhost
  gascity -->|"text, activity, end, error"| adapter
  adapter --> store
  adapter -->|"foreign chunks"| list
  adapter -->|"holds the same chat lock"| streamhost
```

### Sequence diagram — current

```mermaid
sequenceDiagram
  participant User
  participant Facade as Renderer facade
  participant Host as Chat stream host
  participant Agent as handleLocalAgentStream
  participant Model as Model provider
  participant Tool as Tool harness
  participant UI as Message list

  User->>Facade: submit prompt
  Facade->>Host: IPC chat:stream
  Host->>Host: take the chat lock, store the user message
  Host->>Agent: run local agent
  Agent->>Model: streamText
  loop tokens and tool calls
    Model-->>Agent: text-delta or tool-call
    Agent->>Tool: execute
    Tool-->>Agent: result
    Agent->>Model: tool result
    Agent-->>UI: chat:response:chunk
  end
  Agent-->>UI: chat:response:end
  Host->>Host: release the chat lock
```

A GasCity `POST /runs` enters at the chat stream host and then follows
this same sequence. A GasCity `POST /messages` skips the loop and inserts
one finished row.

### Sequence diagram — B

```mermaid
sequenceDiagram
  participant User
  participant Host as Chat stream host
  participant Backend as AgentBackend
  participant Native as Native backend
  participant Remote as GasCity backend
  participant GC as GasCity
  participant UI as Message list

  User->>Host: IPC chat:stream
  Host->>Host: take the chat lock
  Host->>Backend: run turn

  alt selected backend is native
    Backend->>Native: run turn
    Native->>Native: today's streamText and tool loop
    Native-->>Backend: agent events
  else selected backend is GasCity
    Backend->>Remote: run turn
    Remote->>GC: start the chosen agent
    GC-->>Remote: text, tool activity, error
    Remote-->>Backend: the same agent events
  end

  Backend-->>UI: chat:response:chunk
  Backend-->>UI: chat:response:end
  Host->>Host: release the chat lock
```

### Sequence diagram — C

```mermaid
sequenceDiagram
  participant User
  participant Thin as Thin Dyad main
  participant Router as GasCity router
  participant Agent as Selected agent
  participant Tools as Dyad workspace tool API
  participant UI as Message list

  User->>Thin: IPC chat:stream
  Thin->>Router: every prompt, including ordinary chat
  Router->>Agent: Dyad agent or another agent
  loop execution
    Agent->>Tools: read or edit the local app when needed
    Tools-->>Agent: result
    Agent-->>Thin: text, activity, error
    Thin-->>UI: chat:response:chunk
  end
  Agent-->>Thin: turn end
  Thin-->>UI: chat:response:end
```

### Sequence diagram — D

```mermaid
sequenceDiagram
  participant User
  participant Host as Chat stream host
  participant Agent as Local agent
  participant Adapter as Event adapter
  participant GC as GasCity
  participant UI as Message list

  alt native prompt
    User->>Host: IPC chat:stream
    Host->>Agent: today's loop
    Agent-->>UI: chat:response:chunk
    Agent-->>UI: chat:response:end
  else GasCity-managed agent
    User->>Host: prompt that Dyad forwards
    Host->>GC: start the chosen agent
    GC-->>Adapter: text, activity, end, error
    Adapter->>Host: hold the same chat lock
    Adapter-->>UI: chat:response:chunk
    Adapter-->>UI: chat:response:end
  end
```

### What moves

| Box | Current | B | C | D |
| --- | --- | --- | --- | --- |
| Renderer and message list | Paints chunks | Same | Same | Same |
| Chat stream host | Owns the turn | Calls `AgentBackend` | Replaced by a GasCity client | Same, plus a lock share with the adapter |
| Local agent | The only executor | Wrapped as the native backend | Moves into GasCity | Stays |
| Tool harness | In the main process | Used by the native backend | Exposed as a callback API | Stays on the native path |
| Model provider | Called by Dyad | Called by the native backend | Called by GasCity | Called by Dyad for native turns |
| Host bridge | Starts Dyad, or appends a finished message | Competes with the new backend client | Replaced by the turn client | Gains the event adapter |
| GasCity | Optional starter of the Dyad agent | Executor when that backend is selected | Executor of every turn | Executor of foreign agents only |

## 11. Decision criteria when GasCity is the orchestrator

The ranking D > C > B is a ranking of how little Dyad's agent loop moves.
It is not a ranking of orchestration. The goal in this section is the
stronger one: GasCity decides which agent runs, and Dyad's UI can show
either that agent or the native agent through one stream, without copying
the tool harness into GasCity.

### Corrected definitions

**D — event projection.** One side emits facts. The other paints or
reacts. In the diagram above, GasCity emits text and activity, and a
Dyad adapter writes `chat:response:chunk`. The native
`handleLocalAgentStream` function stays on its own call path. D does not
adapt Dyad's events so that GasCity can steer Dyad. That reverses the
arrow. An outbound variant, where Dyad emits events and GasCity listens,
is also D: it is observation. Martin Fowler calls that event notification.
The sender does not depend on a response. Using an event as a disguised
order is what he calls a passive-aggressive command.

**C — GasCity owns the agent loop.** Prompts, model calls, retries, and
workflow state run in GasCity for every factory turn, including the turn
that used to be Dyad's local agent. Dyad keeps the UI and the files.
C does not require a line-by-line port of `TOOL_DEFINITIONS` on day one.
It does require those tools to be reachable from GasCity, because the
files, git repo, preview process, and consent checks live in the Electron
app. That callback is a second product surface. The loop itself
(`streamText`, prompt assembly, tool-transcript sanitizing, the chat
lock) would leave `local_agent_handler.ts`.

**B — Dyad owns the call.** The chat stream host calls an `AgentBackend`.
The native backend wraps today's loop. A GasCity backend is the other
implementation. The user was right that this puts the integration inside
Dyad. The host in `src/chat_stream/` remains the component that admits
the turn. GasCity is a callee.

**What the bridge is today.** None of the three. `POST /v1/apps/:id/phases/:phase/runs`
is a command from GasCity to Dyad: start `local-agent` with this prompt.
`GET /v1/runs/gas-city-run:…` returns status and, after the turn ends,
one final assistant message. `POST …/messages` inserts a finished bubble.
Question and answer routes exist for HITL. There is no cancel route on
the bridge, and neither direction has a live token or tool-event stream.
Idempotency keys already exist on runs and messages.

### Calling interface versus event interface

| | Calling interface | Event interface |
| --- | --- | --- |
| Meaning | The caller names a receiver and asks it to start, cancel, resume, or answer | A publisher reports that something happened |
| Who decides the next step | The caller, using the return or the task state | Whoever happens to be listening |
| Failure | The caller sees reject, timeout, or a terminal task state | A missed event is silence unless someone polls a store |
| Fits GasCity as orchestrator | Yes. GasCity is the client | Only as the view, or as a log |

A2A draws the same line one level up from tools. MCP is how an agent
reaches its own tools. A2A is how one agent gives another a task.
A2A task states are `submitted`, `working`, `completed`, `failed`,
`canceled`, `rejected`, plus the interrupted states `input-required` and
`auth-required`. Streaming is `SendStreamingMessage`. A dropped stream
resumes with `SubscribeToTask`. `input-required` closes the stream and
the same task continues when the client sends the user's answer.
Cancel is its own operation. MCP has no peer-agent lifecycle. A2A has
no tool-call schema. Dyad's `TOOL_DEFINITIONS` are the tool layer.
GasCity's phase runner wants the task layer.

Temporal makes the same split inside one vendor: a workflow is the
orchestrator, an activity is the worker. Long activities heartbeat, or
cancellation and crash recovery never arrive. The heartbeat details are
the resume cursor. Dyad's factory poll is a weak version of "get task."
It has no heartbeat and no cursor inside the turn.

Choreography (events only) fits short, independent reactions. Orchestration
fits a long branchy flow with cancel, compensation, and an audit of who
ran. A factory phase is the second kind. Camunda, AWS Step Functions
guidance, and the choreography write-ups agree that the two styles can
live together: orchestrate the phase, publish events for the UI.

### Comparison matrix

| Dimension | D, event projection | C, loop moves to GasCity | B, Dyad calls GasCity |
| --- | --- | --- | --- |
| Who starts, cancels, and resumes | Nobody new. Native turns stay with the chat stream host. Foreign turns are whatever the event producer does outside Dyad | GasCity | Dyad's chat stream host |
| Dyad agent, tools, and harness | Kept in place for native turns. Foreign agents do not use them | Loop leaves Dyad. Tools stay only if GasCity calls back | Kept, behind `AgentBackend`, for the native backend only |
| One calling path for both agents | No. Native stays on `chat:stream`. Foreign agents use a different producer | Yes, and that path is GasCity | Yes, and that path is Dyad |
| Live UI stream | Yes, if the adapter writes `chat:response:chunk` | Yes, if GasCity's events are mapped to the same chunks | Yes, if both backends feed one chunk mapper |
| User input, approval, cancel, HITL back to GasCity | Only if someone adds commands. Events do not carry the return path | Natural, because GasCity is already the waiter | Dyad receives them first and must forward |
| Execution state | Split. Dyad owns the chat row and the chat lock. GasCity owns the phase only if it keeps its own store | GasCity owns the workflow. Dyad still owns the visible transcript unless that moves too | Dyad owns the turn. GasCity owns whatever happens inside its backend |
| Retry, reconnect, long runs | A UI patch can be resent. The run itself has no shared cursor | One workflow history. Electron quitting no longer kills the loop | Dyad retries only while its process lives. GasCity retries only its own backend |
| What changes when Dyad's agent changes | Native path changes as it does today. The adapter breaks only if chunk XML changes | GasCity's copy or callback breaks | `AgentBackend` breaks if the event vocabulary changes |
| Adding a third agent | Add another event producer that speaks chunk XML | Register another worker behind GasCity | Implement another `AgentBackend` inside Dyad |
| New pieces | Inbound adapter, chat-lock sharing | Turn client, workspace tool API, a new home for the loop | `AgentBackend`, GasCity client, shared chunk mapper |
| Electron quits mid-run | Native run dies with the process. A foreign run can continue only if it was not inside Dyad | The loop can continue. Local tools cannot, until the app returns | Both the caller and the native worker die |

### When an architect picks each one

**Pick D** when the UI is the problem and control is already solved
somewhere else. You have a producer of text and tool activity, and you
need the existing message list to paint it. You accept two call paths.
Choose the outbound-only form of D when GasCity needs an audit log and
must not be on the critical path of a keystroke.

**D is not enough** when GasCity must choose the agent, stop it, wait
for an approval, branch on a tool result, or recover a turn after the
stream drops. An event adapter can show those facts. It cannot be the
thing that issues them. Today's `GET /runs` already shows the gap: GasCity
can see `queued`, `running`, `completed`, `cancelled`, or `errored`, and
then one final message. It cannot see tool calls as they happen, and it
cannot cancel the run through this API.

**Pick C** when the worker process is the problem. The factory turn must
keep running after Dyad quits, the laptop sleeps, or a second UI (not
this Electron app) must drive the same loop. Also pick C when you want
one prompt, one retry policy, and one transcript implementation, and you
accept a remote tool boundary. C is the expensive way to get a single
caller. It is the cheap way to get a caller that outlives the desktop app.

**Pick B** when the user always starts in Dyad and ordinary chat must
run with GasCity unavailable. The shared interface then belongs in the
chat stream host, because that host already serializes turns. Pick B
when GasCity agents are optional backends, not the owner of the phase.
B fights the goal "GasCity is the primary orchestrator."

**Use both a call and an event stream** when GasCity must orchestrate
and Dyad must paint. The call is the task (`start`, `cancel`,
`input-required`, `subscribe`). The event stream is the view
(`chat:response:chunk`). CQRS is this split: the command model and the
read model are allowed to differ. The factory bridge has the command
(`POST /runs`) and a finished-message write (`POST /messages`). It does
not yet have the live read model in either direction.

### Sequences for the corrected options

D, as a view. GasCity is not on the native call.

```mermaid
sequenceDiagram
  participant User
  participant Dyad as Dyad chat host
  participant Agent as Dyad local agent
  participant Adapter as Chunk adapter
  participant GC as GasCity

  alt native turn
    User->>Dyad: chat:stream
    Dyad->>Agent: handleLocalAgentStream
    Agent-->>User: chat:response:chunk
  else foreign agent, view only
    GC-->>Adapter: text, tool activity, end
    Adapter-->>User: chat:response:chunk
  end
```

C, one caller. The loop no longer starts in Dyad.

```mermaid
sequenceDiagram
  participant User
  participant Dyad as Dyad UI and tool API
  participant GC as GasCity
  participant Agent as Agent running in GasCity

  User->>Dyad: prompt
  Dyad->>GC: start task
  GC->>Agent: run
  Agent->>Dyad: tool callback for files, git, preview
  Agent-->>GC: status and artifacts
  GC-->>Dyad: task events
  Dyad-->>User: chat:response:chunk
  User->>Dyad: cancel or HITL answer
  Dyad->>GC: cancel or input-required reply
```

B, Dyad is the caller.

```mermaid
sequenceDiagram
  participant User
  participant Host as Dyad AgentBackend
  participant Native as Native backend
  participant GC as GasCity backend

  User->>Host: chat:stream
  alt native
    Host->>Native: run turn
    Native-->>User: chunks
  else GasCity agent
    Host->>GC: run turn
    GC-->>Host: events
    Host-->>User: chunks
  end
```

The shape that matches "GasCity orchestrates, Dyad keeps the harness":
GasCity is the A2A-style client, the Dyad agent is one worker, other
agents are other workers, and a projector writes chunks. Tools stay
inside the Dyad worker.

```mermaid
sequenceDiagram
  participant User
  participant UI as Dyad UI
  participant GC as GasCity orchestrator
  participant Dyad as Dyad agent worker
  participant Other as Other agent worker

  User->>UI: prompt or HITL answer
  UI->>GC: forward input for a factory phase
  GC->>Dyad: start, cancel, or resume task
  GC->>Other: or start a different worker
  Dyad-->>GC: status, tool activity, input-required, result
  Other-->>GC: the same task events
  GC-->>UI: those events
  UI-->>User: chat:response:chunk
```

On that path the native agent is reused by being called, not by being
copied and not by being hidden behind a Dyad-owned backend interface.
Ordinary non-factory chat can keep today's `chat:stream` path so a
missing supervisor does not take down the editor.

### Recommendation

D > C > B is a sound preference for disruption and for UI reuse. It is
the wrong preference for orchestration ownership.

For the stated goal, build the missing half of the bridge as a task
interface and keep D as the projector into `chat:response:chunk`. Do not
start by moving `handleLocalAgentStream` into GasCity. Do not start by
adding `AgentBackend` under the chat stream host.

That recommendation flips if a factory run must survive the Electron
process exiting. The local agent cannot. C, or an out-of-process worker
that still calls the same tools, becomes the deciding requirement. It
also flips back toward B if factory mode is optional and the chat host
must stay the only caller.

### Findings that would change this

These are not answered by this repository:

1. Must a phase keep running after Dyad quits or the machine sleeps?
2. Does GasCity branch on tool results and HITL, or only on the final assistant message it can already poll?
3. Is there a GasCity task or event schema, or is `POST /runs` plus `GET /runs` the whole contract?
4. When GasCity switches agents, do they share one phase chat or one chat each? The bridge currently resolves one chat per phase.
5. Will a non-Dyad agent edit files itself, or will it only ask the Dyad worker to edit? Self-edit requires the tool callback even if the loop stays in Dyad.
6. Must ordinary chat work while the supervisor is down? If yes, the native `chat:stream` path stays beside the factory task path.

### Sources

- Event notification versus command: [Martin Fowler, "What do you mean by Event-Driven?"](https://www.martinfowler.com/articles/201701-event-driven.html)
- Separate read and write models: [CQRS](https://martinfowler.com/bliki/CQRS.html)
- Agent-to-agent tasks, streaming, cancel, and `input-required`: [A2A specification](https://a2a-protocol.org/latest/specification/), [streaming and async](https://a2a-protocol.org/latest/topics/streaming-and-async/), [protocol definition](https://a2a-protocol.org/latest/definitions/)
- MCP is the tool layer, not the peer-agent layer: [MCP specification, 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/index.mdx), [MCP vs A2A](https://jonmoshier.com/notes/mcp-vs-a2a/)
- Workflow owns the steps; the activity heartbeats or cancel and resume never arrive: [Temporal long-running activity](https://docs.temporal.io/design-patterns/long-running-activity)
- Orchestrate the long branchy flow; choreograph independent reactions: [AWS orchestration guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/orchestration.html), [Camunda](https://camunda.com/blog/2023/02/orchestration-vs-choreography/), [Ben Morris](https://www.ben-morris.com/orchestration-vs-choreography-for-microservice-workflows/)

## Verified versus proposed

Verified: the lifecycle, tool list, IPC names, chunk schema, the host
bridge routes (`POST /runs`, `GET /runs`, `POST /messages`, HITL
questions and answers), and the absence of a bridge cancel route or a
live event stream. The current diagrams describe that path.

Proposed: options B, C, and D, the task-shaped calling interface, the
chunk projector, and any claim that GasCity already emits a compatible
stream. This repository does not contain that GasCity emitter. The
external sources describe the patterns. They do not describe this
codebase.
