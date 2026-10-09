# Minimum workflow semantics for the human-in-the-loop factory

Assessment of the "two kinds of human intervention" framework against the code in this repository, with a reading of GitHub Spec Kit and OpenSpec against the seven questions it raises. Companion to `plans/galan-software-factory.md` and `plans/oss-foundations-evaluation.md`. Nothing in this repository changes.

The framework names three concerns: execution, coordination, governance. This document uses the same three to say what exists, what the code assumes, and what Experiments A and B must prove.

## 1. What the repository already decides

The framework describes the two approaches as a choice. The code has already made it, in one direction, and partly built the other.

| Concern                                  | What exists                                                                                                                                                                                                                                                                                                                                                                             | Path                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governance: phases                       | Three phases, a constant. Discovery is `ask` mode, the other two `build`. The next phase unlocks when the previous one is approved.                                                                                                                                                                                                                                                     | `src/lib/factoryPhase.ts`: `FACTORY_PHASES`, `isFactoryPhaseUnlocked`                                                                                            |
| Governance: phase approval               | A row per `(appId, phase)`. The Continue button appears only after the agent writes a `## <Phase> summary` heading. Two IPC paths: `factory.approve` requires the `approve-<phase>` permission, which only the project manager holds; `factoryHost.approvePhase`, used when the app is GasCity-managed, has no role check.                                                              | `factory_records.ts`: `approvePhase`; `adminAccess.ts`: `ADMIN_ROLES`; `factory_host_service.ts`: `approveFactoryPhase`; `FactoryPhaseBar.tsx`: `recordApproval` |
| Governance: role-routed gates            | Three gate step ids map to a role. The question body is visible to that role only; the other role sees status. Decided by `decideAnswer`.                                                                                                                                                                                                                                               | `src/control_plane/hitl.ts`: `GATE_ROLE`, `presentQuestion`, `decideAnswer`                                                                                      |
| Coordination: gate question storage      | `hitl_questions` and `hitl_answers` in SQLite, mirrored to Neon `control_questions` and `control_answers`. Created by a machine token, answered by a Clerk session. Idempotent on `(orgId, idempotencyKey)`.                                                                                                                                                                            | `hitl_device.ts`, `hitl_store.ts`, `factory_host_bridge_server.ts` lines 139–225                                                                                 |
| Coordination: resume after a gate answer | Not in the bridge. `answerHitlQuestion` stores the answer, mirrors it to Neon, and returns `resolved: false` unconditionally. A Python worker selects `wewebplus.answers` with `gate_resolved_at` null, runs GasCity's `hitl.py respond --as <name>` then `release`, and stamps the row. It matches by `answered_by_name`, not user id or role. Nothing in the repository schedules it. | `hitl_device.ts` lines 141–200; `scripts/gascity/resolve_hitl_answer.py`; `control-plane/drizzle/0002_gate_resolved_at.sql`                                      |
| Coordination: agent-triggered question   | `planning_questionnaire` tool: one to five questions, radio, checkbox, or text. The chat turn parks until answered. Receipts are journaled to disk with outcomes `pending`, `answered`, `dismissed`, `interrupted` and recovered after restart. Single user, same chat, no role.                                                                                                        | `src/pro/main/ipc/handlers/local_agent/tools/planning_questionnaire.ts`, `src/user_input/`                                                                       |
| Execution: running an agent              | A phase run is a chat intent dispatched to Dyad's local agent. `startFactoryRun` is idempotent on `(appId, phase, idempotencyKey)` and refuses a reused key with a different prompt.                                                                                                                                                                                                    | `factory_host_service.ts`: `startFactoryRun`                                                                                                                     |
| Execution: run status                    | `queued`, `running`, `completed`, `cancelled`, `errored`, `rejected`, derived from the chat intent. No status means "waiting for a person".                                                                                                                                                                                                                                             | `factory_host_service.ts`: `readFactoryRun`                                                                                                                      |
| Coupling to GasCity                      | A question requires `gateBeadId`. A run and a phase approval over the bridge require `factoryHostManaged`, which `linkFactoryApp` sets with a GasCity project id.                                                                                                                                                                                                                       | `factory_host_bridge_server.ts`: `QuestionBody`, lines 267 and 284                                                                                               |

Three consequences for the framework:

1. Approach B is implemented, with hardcoded phases and a summary heading as the acceptance signal. The role check on Continue exists on the control-plane path and is skipped on the GasCity-managed path, so the factory that runs on the city host is the one without it.
2. Approach A exists for one user inside one chat, with durable pause and resume, and does not exist across users or roles. The role-routed store exists; its resume path is a GasCity-specific worker that reads the Neon mirror and closes a bead by the answerer's display name.
3. "We may not need GasCity" is true of the storage and the role rule, and not yet true of the bridge, which refuses a question without a bead id and a run without a linked project.

## 2. The pause is a classification, not a state

The framework says a stop must be sorted into completion, recoverable failure, infrastructure error, or human required. This is forced by the execution backend, not chosen.

- Dyad's local agent: a chat turn ends. `readFactoryRun` reports `completed`, `cancelled`, or `errored`. The `planning_questionnaire` tool is the one case where the turn holds open for a person, and it holds the stream open on one machine.
- Cursor Cloud Agent: a run ends in `FINISHED`, `ERROR`, `CANCELLED`, or `EXPIRED` (`auto-app/lib/cursor/client.ts`, Paperclip `packages/adapters/cursor-cloud`). There is no paused status. A follow-up starts a new run. Nothing in the ten projects evaluated receives an event from Cursor; all poll or stream.

So for a Cloud Agent, "Agent Running → Human Required" is: the run finishes, and something in its output says it stopped for a person. The coordination layer must recognize that output. Four ways to carry it, from least to most infrastructure:

| Carrier                                                       | Precedent in this repo                                                                     | Cost                                                                 | Risk                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A structured block in the final message                       | `## <Phase> summary` heading, parsed by `extractFactoryPhaseSummary`; `<dyad-status>` tags | Prompt text and a parser                                             | The model forgets the block, or writes it and keeps working         |
| A file on the branch, for example `.galan/requests/<id>.json` | OpenSpec and Spec Kit keep all state as files in the repository                            | A commit per request; readable by GitHub Actions and by the next run | Needs a push; merge noise                                           |
| A pull request comment or review request                      | Preview label flow in `deploy/preview/`                                                    | GitHub API call from the agent; GitHub becomes the inbox             | Role is a GitHub permission, not a Galan role                       |
| A call from the agent to our bridge with a machine token      | `POST /v1/apps/:id/phases/:phase/questions` already exists for GasCity                     | A token in the agent environment; `gateBeadId` made optional         | The agent holds a token that can create questions for the whole app |

The classification rule, whichever carrier: terminal status crossed with marker presence.

| Run status          | Marker present     | Classification        | Next                                           |
| ------------------- | ------------------ | --------------------- | ---------------------------------------------- |
| finished            | request for a role | human required        | create a request; route; wait                  |
| finished            | phase summary      | ready for approval    | show Continue to the approving role            |
| finished            | none               | completed, unverified | run acceptance check or ask for a summary      |
| errored, message    | any                | recoverable failure   | retry with the error, bounded                  |
| errored, no message | any                | infrastructure error  | escalate to the operator role, not the project |
| cancelled, expired  | any                | abandoned             | reopen as a new run from the last request      |

Only the first row creates human work for a project role. This is the rule the framework asks for in its "important distinction".

## 3. Minimum semantics

Two records and one loop are enough to run both approaches. Names below are descriptive, not a schema.

**Run**: `id`, `appId`, `phase`, `backend` (`dyad-local` | `cursor-cloud`), `backendRef` (`cursorAgentId` + `latestRunId`, or a chat intent id), `status` from section 2, `startedByRequestId`, `finalMessageRef`. `factoryHostRuns` holds most of this today for the local backend.

**Request**: `id`, `appId`, `phase`, `runId`, `kind` (`question` | `decision` | `approval`), `targetRoleId`, `body`, `status` (`open` | `answered` | `withdrawn`), `answer`, `answeredByUserId`. `hitl_questions` holds all of this today except `kind`, with `stepId` standing in for it and `gateBeadId` required.

**Loop**: start a run; when it ends, classify; if human required, open a request and stop; when the request is answered, start a new run whose prompt contains the answer; repeat. A phase approval is a request of kind `approval` whose answer unlocks the next phase. The three gate ids in `GATE_ROLE` are approvals with a fixed `targetRoleId`.

What this does not need: a graph of agent steps, a bead, a heartbeat, a board, or a second identity system. What it does need that is missing: the resume edge (answered request starts a run), the classifier, and one role check on phase approval regardless of path.

Business phase and agent activity stay separate as the framework asks: `phase` on Run and Request is the business phase; the agent's current activity is whatever its last message or marker says, and is display only.

## 4. The framework's dimensions, as the code sets them today

| Dimension            | Today                                                                                 | Smallest change to make it configurable                             |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Intervention trigger | Predefined approval; agent-triggered within one chat only                             | Request kind `question` created from a run's marker                 |
| Workflow structure   | Fixed three phases                                                                    | None for Experiment A; one phase named `work` is still a phase      |
| Phase definition     | Hardcoded in `FACTORY_PHASES`                                                         | Out of scope until Phase 2 of the Galan plan                        |
| Human routing        | Role-based for gates and for control-plane Continue; nobody for host-managed Continue | One approval path with the `approve-<phase>` permission check       |
| Approval requirement | Mandatory between phases                                                              | A flag per phase; Delivery already ends without Continue            |
| Agent execution      | One chat turn per run; iteration is the model's                                       | None                                                                |
| Failure handling     | `errored` is terminal; nothing retries                                                | Bounded retry on recoverable failure, from section 2                |
| Progress tracking    | Phase shade: not started, in progress, finished                                       | Requirement coverage needs a parseable spec; see section 5          |
| Completion           | Summary heading plus Continue                                                         | Add a verification result to the summary before Continue is enabled |
| UI presentation      | Phase buttons with the shade; Continue; question list per phase                       | Request inbox per role; one activity line from the last marker      |

## 5. Spec Kit and OpenSpec against the seven questions

Both repositories were cloned on 2026-10-09 and read. Both are MIT. Both keep all state as files in the project repository. Neither calls the Cursor Cloud Agent API.

**Spec Kit** (`github/spec-kit`, Python CLI `specify`). Templates for `spec.md`, `plan.md`, `tasks.md`, checklists, a constitution. `NEEDS CLARIFICATION` markers in `templates/plan-template.md`; `/speckit.clarify` asks at most five questions and writes answers back into the spec (`templates/commands/clarify.md` line 130). `/speckit.converge` assesses the codebase against spec, plan, and tasks and appends missing work to `tasks.md`. A workflow engine under `src/specify_cli/workflows/` runs YAML step lists: `command`, `prompt`, `shell`, `gate`, `if`, `switch`, `while`, `fan-out`. The `gate` step prompts on a TTY and returns `PAUSED` otherwise, with state in `.specify/workflows/runs/<run_id>/state.json`; `specify workflow resume <run_id> --input verdict=approve` resumes through `verdict_input`; `on_reject` is `abort`, `skip`, or `retry` (`step/gate/__init__.py`). Command and prompt steps dispatch to local agent CLIs; the Cursor integration runs `cursor-agent -p --trust --approve-mcps --force` (`integrations/cursor_agent/__init__.py` line 8).

**OpenSpec** (`Fission-AI/OpenSpec`, TypeScript CLI `openspec` 1.14.1). A change is `openspec/changes/<name>/` with `proposal.md`, `design.md`, `tasks.md`, and delta specs under `specs/<capability>/spec.md`. The artifact graph (`schemas/spec-driven/schema.yaml`) declares `requires` between artifacts; completion is file existence (`src/core/artifact-graph/state.ts`). `openspec validate` requires every added or modified requirement to have at least one `#### Scenario:` (`src/core/validation/validator.ts` line 153). `openspec status --json` and `openspec list --json` report artifact completion and `completedTasks` over `totalTasks`. `openspec archive` merges deltas into the main specs. There is no runtime: "The CLI does not route tasks" (`src/core/change-status-policy.ts` line 73). Pause is prompt text in `src/core/templates/workflows/apply-change.ts` lines 134–147 and 204–209. The propose workflow stops after planning and waits for a new user request (`propose.ts` line 39).

| Question                                                          | Spec Kit                                                                                                      | OpenSpec                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Resume after an external human response                        | Yes, for its own engine: `PAUSED` state on disk, `workflow resume` with `verdict_input`. Local, one machine.  | Yes, trivially: there is nothing running. The next agent run reads the files.                       |
| 2. Expose unresolved questions and decisions                      | Partly: `NEEDS CLARIFICATION` markers in templates; `clarify` is interactive text, not a record.              | No marker. "Ask for clarification" is an instruction to the agent, not an artifact.                 |
| 3. Machine-readable acceptance criteria and verification results  | Tasks as `- [ ] T001` checkboxes; `check-prerequisites --json` for presence. No scenario parser. No results.  | Requirement and scenario blocks parsed and validated; `status --json`, `list --json`. No results.   |
| 4. Iterate between spec and implementation without restarting     | Yes: `converge` appends tasks; `clarify` rewrites the spec in place.                                          | Yes: `update-change` workflow; delta specs are edited in place; `archive` only at the end.          |
| 5. External orchestrator controls phase advancement               | Its engine wants to be the orchestrator. Used without the engine, phases are just which command runs next.    | Yes by construction: the orchestrator decides which workflow prompt to send next.                   |
| 6. Add mandatory approval gates without modifying the framework   | The engine has gates, but they have no identity or role and pause the local process. Outside the engine, yes. | Yes: a gate is "do not send `apply-change` until approved", which is already how `propose` behaves. |
| 7. Track requirement-level progress independent of agent activity | Task checkboxes only; requirements are prose.                                                                 | Requirements and scenarios are addressable; tasks counted. Verification status would be ours.       |

Reading: both are artifact-and-prompt frameworks, and that is the right shape for the framework's "lightweight surrounding coordination layer", because the coordination layer stays ours. The difference is on questions 3 and 7. OpenSpec's requirement and scenario structure is what a "requirements satisfied: 18 of 25" line needs; Spec Kit's spec is prose with task checkboxes. Spec Kit's workflow engine overlaps with our coordination layer rather than sitting under it: its gate is a TTY prompt or a file on one machine, it dispatches to the local `cursor-agent` and not to a cloud run, and it knows nothing about who approved. Its `converge` command is the clearest written form of Model 1 and is worth reading before writing our acceptance check.

Neither kit emits a verification result. "Requirements verified" means we run the check and store the result against the requirement id, under either kit.

## 6. What the UI can show from data that exists

| UI element             | Source today                                           | Source after Experiment A                                        |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Phase timeline         | `factoryPhaseShade` from approvals and started chats   | Same                                                             |
| Current activity       | None                                                   | Last marker or last assistant message of the latest run          |
| Human action required  | Open `hitl_questions` for the caller's role, per phase | Open requests for the caller's role, any kind                    |
| Phase approval         | Continue, after the summary heading                    | A request of kind `approval`, visible to the approving role only |
| Requirements satisfied | None                                                   | OpenSpec requirement ids with a stored verification result       |
| Percent complete       | None, and none proposed                                | None                                                             |

The framework's two UI variants differ only in the first and last rows. Everything else is the same inbox.

## 7. Experiments A and B, against this code

**Experiment A: dynamic intervention, no new phases.** One app, one organization, one project manager, one developer, Dyad's local agent first, then a Cursor Cloud Agent.

Proves: a run ends with a request marker; a request is created for a role; the other role cannot read it; the target role answers; a new run starts with the answer in its prompt; the run record shows both runs and the request between them; a restart of the host between answer and resume loses nothing.

Needs, as findings rather than changes made here: a resume edge that does not depend on GasCity's `hitl.py` or on a display name; the classifier from section 2; a request without a bead id. The existing three-phase chats can stay; the experiment runs inside one of them.

Done when: two requests answered by two different roles in one phase, with the second run's prompt containing the first answer, and the request store readable by the second organization returning nothing.

**Experiment B: the phase gate on top.** Same app, GasCity-managed. Make the host-managed Continue pass the same `approve-<phase>` check as `factory_records.approvePhase`. Keep the three gate ids as approvals.

Proves: the loop in A runs inside each phase; the next phase does not unlock on an answer, only on an approval by the approving role; a summary heading from the agent is necessary and not sufficient.

Done when: a developer's Continue on Discovery is refused on both IPC paths, a project manager's is accepted on both, and Implementation runs the A loop afterward.

Only after B: whether a bead, a Paperclip issue, or nothing should hold the Run and Request records. The Galan plan's Experiments A, C, and G stay as written; this document narrows their first step.

## 8. Open points this does not settle

- Which carrier from section 2 a Cursor Cloud Agent uses to signal a request. The bridge call is the most reliable and gives the agent a token; the file carrier is the most inspectable and needs a push.
- Whether the local `planning_questionnaire` pause should become a request when the asked-for role is not the person in the chat, or stay a separate, faster path for the same person.
- Whether verification results live on the request, on the run, or on the requirement id. Section 6 assumes the requirement id.
- Whether Spec Kit's `clarify` five-question limit and option format should be copied into our request body shape. The `planning_questionnaire` tool already has a near-identical limit and shape.

## 9. Out of scope

No code, schema, bridge route, or prompt in this repository changes. Spec Kit and OpenSpec are not installed. GasCity and Paperclip are not removed or adopted. The Galan plan's phases, levels, and experiments are unchanged.
