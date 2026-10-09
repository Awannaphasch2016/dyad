# Open-source foundations for the Galan software factory

Evaluation of ten repositories against `plans/galan-software-factory.md`. Source was read, not READMEs. Every claim names a path in the clone it came from. Nothing in this repository changes.

Repositories were cloned on 2026-10-09. Star counts and dates are from that day.

## 1. Requirements baseline

The plan is the source of truth. Requirements below are grouped by whether they are needed for Phase 1, the Level 0 factory, or later.

| #   | Requirement                                                                      | Need                                  | Status in this repo                                                                                         |
| --- | -------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1  | Cursor Cloud Agent as the coding backend, over the remote API, not the local CLI | Phase 1                               | Not integrated. No call to `api.cursor.com` or `@cursor/sdk` in the tree.                                   |
| R2  | Isolated execution per coding task                                               | Phase 1                               | Cursor's cloud provides it today. Self-hosted workers are not set up.                                       |
| R3  | Organizations, users, roles, permissions                                         | Phase 1 for one org, Phase 6 for many | Clerk. One hardcoded org and two hardcoded user ids in `src/control_plane/hitl.ts`.                         |
| R4  | HITL approvals routed to a role                                                  | Phase 1                               | Done for three gates: `GATE_ROLE` in `src/control_plane/hitl.ts`. The other role sees status, not the body. |
| R5  | Configurable agent instructions, tools, workflows                                | Phase 2 onward                        | GasCity formulas are the only editable artifact (`src/lib/formula/`). No tool or agent definition.          |
| R6  | Orchestration, delegation, task lifecycle                                        | Phase 4 and 5                         | GasCity beads on the city host. Factory phases hardcoded in `src/lib/factoryPhase.ts`.                      |
| R7  | Shared project context and persistent workflow state                             | Phase 1                               | Postgres on Neon, `wewebplus.*` tables, GasCity SQLite for beads.                                           |
| R8  | GitHub repository, branches, pull requests                                       | Phase 1                               | Workflows under `.github/workflows/`. Pull request label `preview`.                                         |
| R9  | Preview deploy, CI, promotion                                                    | Phase 1 for preview                   | `preview.yml`, `preview-formula.yml`, `gascity-rollout.yml`. Branch-push triggers, no tool contract.        |
| R10 | Browser end-to-end verification                                                  | Phase 1                               | Playwright E2E in `ci.yml`; preview curl checks in the preview workflows.                                   |
| R11 | Credentials and tenant isolation                                                 | Phase 1                               | Doppler, GitHub OIDC role for ECS, `EC2_SSH_KEY`. Isolation is one tenant.                                  |
| R12 | Visibility into agent runs, failures, outputs                                    | Phase 1                               | GitHub Actions logs. Nothing for a Cursor agent's run.                                                      |

Mandatory for Phase 1: R1, R2, R3 (one org), R4, R7, R8, R9 (preview), R11, R12.
Optional in Phase 1: R10 beyond what CI already does.
Later: R5, R6, R3 for many organizations.

Constraints carried from the plan: GitHub Actions stays one execution backend among several; the coding backend must stay replaceable; a long-running agent that pauses for a person is not forced into a CI job; existing workflows are reused, not rewritten.

No requirement is added here because a project happens to support it.

## 2. Project analysis

Ten repositories, in the order given. "Cursor API" means the Cloud Agents REST API or `@cursor/sdk`, not local IDE config.

### 2.1 AIWG, `jmagly/aiwg`

MIT. 3,897 commits since 2025-08-14, 220 stars, CalVer tags several times a week.

What it is: a library of agent personas, skills, rules, and YAML flow playbooks, plus a CLI that writes them into each IDE's config directory. `tools/agents/providers/cursor.mjs` writes `.cursor/agents`, `.cursor/commands`, `.cursor/rules`, `.cursor/skills`, `.cursor/environment.json`. About 103 agent markdown files under `agentic/code/frameworks/sdlc-complete/agents/`, 27 playbooks under `.../flows/*.playbook.yaml`, roughly 1,170 `SKILL.md` files.

Cursor API: none. Zero matches for `api.cursor.com`. `src/cli/agent-spawn.ts` marks Cursor as `binary: null`, "IDE-integrated and cannot be spawned". Cursor support is file generation for the local IDE.

HITL: both prompt text and code. `agentic/code/frameworks/sdlc-complete/rules/hitl-gates.md` is instruction text. `agentic/code/addons/composition-engine/lib/runtime.mjs` throws `APPROVAL_REQUIRED` when a `gate` node is not in `approvedGates`. No role model decides who may approve.

Tenancy: none for end users. `src/auth/` is an OAuth client to the project's own release server. `src/policy/authorization.ts` is a file-based local permission table.

Reusable alone: the persona and SDLC skill library, the Cursor file generator, the playbook schema.

Trade-off: it is an authoring framework for IDE agents, not a control plane. Adopting it would give us prompt content and a schema example, and nothing for R1, R3, R4, R7, or R12.

### 2.2 Cursor Cloud Agent MCP, `jxnl/cursor-cloud-agent-mcp`

MIT. 7 commits on one day, 2025-11-25. 8 stars.

What it is: an MCP server with tools over the v0 API. `src/backend.ts` calls `POST /v0/agents`, `GET /v0/agents`, `GET /v0/agents/{id}`, `POST /v0/agents/{id}/followup`, `GET /v0/agents/{id}/conversation`, `DELETE /v0/agents/{id}`, `GET /v0/repositories`, `/v0/models`, `/v0/me`. No state, no database, no approvals.

Cursor API: the whole project. API v0, which the later projects have moved off.

Reusable alone: the tool descriptions in `src/backend.ts` as a reference for which operations an agent wants.

Trade-off: unmaintained since the first day, built on the older API version. It is a demonstration that the endpoints exist.

### 2.3 RTS Agents, `AJFrio/RTS-Agents`

No `LICENSE` file; `package.json` says MIT. 581 commits since 2026-01-19, last 2026-09-16, 2 stars, no tags, about 6 contributors.

What it is: an Electron desktop dashboard that lists and creates tasks across local CLIs and cloud agents, with a Cloudflare Worker shell and a headless runner. `src/main/ipc/provider-registry.js` is a switch over `antigravity, jules, cursor, codex, claude-cli, claude-cloud, opencode`.

Cursor API: `src/main/services/cursor-service.js` calls `https://api.cursor.com/v1`: `POST /agents`, `GET /agents`, `GET /agents/{id}`, `GET /agents/{id}/runs`, `GET /agents/{id}/runs/{runId}`, `POST /agents/{id}/runs` for follow-ups, `/me`, `/models`, `/repositories`. Basic auth with the key. Polling every 30 seconds from `main.js`; no webhooks; no stop call. Present from the first commit, 2026-01-19.

State: `electron-store` on one machine, with a hardcoded `encryptionKey` in `src/main/services/config-store.js`. Remote queue in Cloudflare KV. One user, one device identity.

HITL: follow-up messages. Jules plan approval state is mapped. Local sessions often run with `permissionPolicy: 'allow-all'`.

GitHub: `src/main/services/github-service.js` lists repos and branches, lists and merges pull requests, reads checks.

Reusable alone: `cursor-service.js` as a plain v1 client, if rewritten without Electron IPC. The license gap blocks copying it as-is.

Trade-off: single-user desktop software. No tenancy, no server, no role model, no license file.

### 2.4 Paperclip, `paperclipai/paperclip`

MIT. 4,925 commits since 2026-02-16, 99,053 stars, 16,715 forks, canary tags daily and stable tags about weekly, 20 CI workflows, about 2,460 test files.

What it is: a multi-tenant control plane where humans (the "board") and agents work on issues. The tenant is a company. Agents have an `adapterType` and `adapterConfig` (`packages/db/src/schema/agents.ts`). Execution happens on a heartbeat (`server/src/services/heartbeat.ts`) that calls `getServerAdapter(agent.adapterType)` from `server/src/adapters/registry.ts`. Postgres through Drizzle, about 158 schema modules.

Cursor API: `packages/adapters/cursor-cloud/` uses `@cursor/sdk`: `Agent.create`, `Agent.resume`, `Agent.getRun`, `run.stream()`, `run.wait()`. Config requires `CURSOR_API_KEY` and a `repoUrl`; supports `repoStartingRef`, `repoPullRequestUrl`, `autoCreatePR`, `workOnCurrentBranch`, `envType` of `cloud | pool | machine` (`src/server/execute.ts` line 35). Stores `cursorAgentId` and `latestRunId` in session params for reattach. Added 2026-05-10 in commit `534aee66a`. Four test files. No inbound Cursor webhook; completion comes from the SDK stream.

Other adapters: `claude-local, codex-local, cursor-local, gemini-local, grok-local, hermes, hermes-gateway, kimi-local, openclaw-gateway, opencode-local, pi-local`. The adapter contract is `ServerAdapterModule` in `packages/adapter-utils/src/types.ts`. Changing the backend is a change to the agent row, not to orchestration.

Tenancy: `companies`, `company_memberships` with `principalType` and `membershipRole` in `owner | admin | member | viewer` (`packages/shared/src/constants.ts` line 964), `instance_user_roles`, `principal_permission_grants`, `board_api_keys`, `agent_api_keys`. `assertCompanyAccess` in `server/src/routes/authz.ts`. Auth is Better Auth with email and password (`server/src/auth/better-auth.ts`). Clerk is not present.

HITL: `approvals` table with `type`, `status`, `payload` (`packages/db/src/schema/approvals.ts`); types include `request_board_approval` and `budget_override_required`. `issue_thread_interactions` carries `ask_user_questions` and `request_confirmation` with `addresseeUserId` / `addresseeAgentId` and resolver policies `anyone | not_creator | human_only` (`constants.ts` line 212 and 261). Approve routes use `assertBoard`.

Lifecycle: issue statuses `backlog, todo, in_progress, in_review, done, blocked, cancelled`; `heartbeat_runs` and `heartbeat_run_events`; `activity_log`; `routines` with cron and webhook triggers; `agent_instruction_revisions`.

GitHub: `server/src/services/chat-github-*.ts`, `github-pull-request-merge.ts`, GitHub App webhook config. Coupled to the chat-channel model.

Execution: local adapters spawn child processes on the server host. The Cursor adapter spawns nothing and runs remotely. Execution targets `local | ssh | sandbox | plugin` in `packages/adapter-utils/src/execution-target.ts`.

Footprint: Postgres and the server (`docker/docker-compose.yml`). `server/src/config.ts` reads 43 environment variables. ECS task definition ships under `docker/`.

Reusable alone: `@paperclipai/adapter-cursor-cloud` with `adapter-utils`; the approval and interaction schema; the membership and grant pattern; the plugin SDK.

Trade-off: it is a full product with its own board UI, auth, and vocabulary (companies, CEO, budgets). Adopting it whole means a second identity system beside Clerk and a second Postgres schema beside `wewebplus.*`. Using its adapter alone means importing `adapter-utils` and following its session contract.

### 2.5 Agents Control Tower, `ofershap/agents-control-tower`

MIT. 20 commits, 2026-03-04 to 2026-05-08, 16 stars.

What it is: a single-user Ink terminal UI. `src/lib/cursor-api.ts` calls v0: list, get, conversation, artifacts, create, followup, stop, delete, repositories, models, me. Config in a local file. Two test files.

Reusable alone: `cursor-api.ts` as a compact v0 client with `stop` and `artifacts`, which the MCP project lacks.

Trade-off: a personal viewer. Nothing for R3, R4, R7.

### 2.6 Cursor Cookbook, `cursor/cookbook`

No license file in the clone. 29 commits since 2026-04-28, 4,118 stars, official.

Three parts matter:

- `sdk/agent-kanban/`: Next.js board over `@cursor/sdk` (`src/lib/agents/server.ts`), one `CURSOR_API_KEY`, groups agents by status or repository, creates cloud agents, previews artifacts. Session route exists but there is no user model.
- `self-hosted-cloud-agent/`: Terraform and Docker for worker pools on EC2, ECS/Fargate, and EKS. Workers dial out to Cursor over HTTPS; Cursor keeps orchestration and the model. This is the one place among the ten that addresses R2 on infrastructure we own.
- `hooks/`: hook examples for prompt guards and audit logs, which run in the agent, not in a control plane.

Reusable alone: the Terraform modules; `agent-kanban/src/lib/agents/server.ts` as the reference for SDK calls, including `Agent.list` and attach limitations noted in the file itself (lines 226 and 545).

Trade-off: examples, by design. No tenancy, no approvals, no persistent state.

### 2.7 AutoApp, `hyfather/auto-app`

Apache-2.0. 58 commits, 2026-05-30 to 2026-06-07, 0 stars.

What it is: a Next.js app with Prisma that takes instructions from Slack, launches a Cursor cloud agent against one repository, and walks the task through `queued, waiting_for_agent, pr_opened, waiting_for_checks, waiting_for_preview_deploy, preview_deployed, waiting_for_merge, waiting_for_production_deploy, production_deployed` (`lib/autoapp/policies.ts`). It polls GitHub checks and Vercel deployments and merges on its own when checks pass (`lib/autoapp/execute.ts` line 403).

Cursor API: `lib/cursor/client.ts`, a typed v1 client with run statuses `CREATING, RUNNING, FINISHED, ERROR, CANCELLED, EXPIRED` and `git.branches[].prUrl`. Replaced Codex on 2026-06-01 in pull request #10. Repo and key are environment variables, so one repository per deployment.

HITL: Slack messages classified by regex in `lib/slack/classifySlackMessage.ts`: `approve|approved|yes|proceed` becomes `human_approval`. No role check on who said it. Guardrails are prompt text in `policies.ts`.

Reusable alone: the task state list is the closest match to R9's lifecycle; `lib/cursor/client.ts` as a dependency-free v1 client under a permissive license.

Trade-off: one repository, one Slack workspace, approval by keyword. Auto-merge without a human conflicts with R4.

### 2.8 Cursor Agents Dashboard, `zirikii/cursor-agents-dashboard`

No license file. 6 commits, 2026-06-25 to 2026-07-14, 0 stars.

What it is: a Next.js viewer over `@cursor/sdk` 1.0.21 (`src/lib/cursor.ts`), with API routes for list, create, archive, runs, and cancel, one `CURSOR_API_KEY`, and a demo mode. The lifecycle visualizer in `src/lib/lifecycle.ts` is scripted demo data.

Reusable alone: the archive and cancel-run routes as SDK call examples.

Trade-off: a demo with no state, no users, no license.

### 2.9 Herdr Cursor, `gabriel-laet/herdr-cursor`

MIT. 11 commits, 2026-08-19 to 2026-09-08, 3 stars.

What it is: a plugin that shows cloud agents as panes in the `herdr` terminal multiplexer. `src/accounts.ts` uses `Cursor` and `FileCredentialStore` from `@cursor/sdk` 1.0.28 and supports several named accounts from `.env` files. `src/rest.ts` exists as a fallback. The README states the project is temporary and will be archived when the Cursor CLI can resume a cloud agent. It also notes team admin keys are rejected by the SDK; use a user or service-account key.

Reusable alone: `accounts.ts` for the named-account and key-resolution pattern, and the status mapping in `src/herdr.ts` line 78.

Trade-off: a personal terminal tool with a declared end of life.

### 2.10 Cursor on Tensorlake, `tensorlakeai/cursor-cloud-agents-tensorlake`

License file present. 4 commits, 2026-09-02 to 2026-09-14, 0 stars. Python, 11 test files.

What it is: an orchestrator sandbox that claims Cursor pool requests and gives each one a worker sandbox; idle workers suspend; follow-ups resume them. `cursor_tensorlake/orchestrator.py`, `pool.py`, `sandbox.py`, `up.py`. The README states pools need a Cursor Enterprise team and a service-account key; a personal key runs one worker under "My Machines".

Reusable alone: the pool-claim and suspend/resume loop as a reference for self-hosted workers.

Trade-off: it solves R2 on one vendor's sandboxes and needs an Enterprise plan for more than one worker. It has nothing above the execution layer.

## 3. Feature coverage matrix

Classification: **I** implemented, **C** configurable, **E** extendable, **M** missing, **X** incompatible.

| Req                                      | AIWG                      | MCP              | RTS                        | Paperclip                              | Tower        | Cookbook              | AutoApp               | Dashboard | Herdr          | Tensorlake           |
| ---------------------------------------- | ------------------------- | ---------------- | -------------------------- | -------------------------------------- | ------------ | --------------------- | --------------------- | --------- | -------------- | -------------------- |
| R1 Cursor Cloud Agent backend            | X (IDE files only)        | I (v0)           | I (v1, polling)            | I (SDK, adapter)                       | I (v0)       | I (SDK example)       | I (v1)                | I (SDK)   | I (SDK)        | I (pool worker side) |
| R2 Isolated execution                    | M                         | M (Cursor cloud) | M (Cursor cloud)           | C (`envType` pool/machine)             | M            | I (Terraform pools)   | M                     | M         | M              | I (sandboxes)        |
| R3 Orgs, users, roles                    | M                         | M                | X (single user)            | I (company, roles, grants)             | M            | M                     | M                     | M         | M              | M                    |
| R4 HITL routed to a role                 | E (gate node, no role)    | M                | M                          | I (approvals, addressee, policies)     | M            | M                     | E (keyword, no role)  | M         | M              | M                    |
| R5 Configurable agents, tools, workflows | I (content) + E (runtime) | M                | C (settings only)          | I (agent config, routines, plugins)    | M            | M                     | C (env, prompt lists) | M         | M              | C (`.env`)           |
| R6 Orchestration, delegation, lifecycle  | E (composition engine)    | M                | E (orchestrator, KV queue) | I (issues, heartbeats, reportsTo)      | M            | E (DAG runner, local) | I (one task pipeline) | M         | M              | M                    |
| R7 Shared state                          | M                         | M                | X (electron-store)         | I (Postgres)                           | M            | M                     | I (Prisma, one repo)  | M         | M              | M                    |
| R8 GitHub repo, PR                       | E (read-only forge)       | M                | I (repos, PRs, merge)      | I (GitHub App, review)                 | M            | M                     | I (checks, merge)     | M         | M              | M                    |
| R9 Preview, CI, promotion                | E (CI generator)          | M                | M                          | E (routines, webhooks)                 | M            | M                     | I (Vercel, one repo)  | M         | M              | M                    |
| R10 Browser verification                 | M                         | M                | M                          | E (plugins)                            | M            | M                     | M                     | M         | M              | M                    |
| R11 Credentials, isolation               | M                         | M                | X (hardcoded key)          | I (per company, key stripped from env) | M            | C (IAM)               | C (env)               | M         | I (key stores) | C (`.env`)           |
| R12 Run visibility                       | M                         | E (tools)        | I (desktop)                | I (runs, events, activity)             | I (terminal) | I (kanban)            | E (Slack posts)       | I (web)   | I (panes)      | E (`tl` logs)        |

Reading the matrix: one project covers more than half of the Phase 1 requirements. Everything else covers R1 and R12 and stops.

What each could replace in this repo:

- Paperclip: the hardcoded org and user ids in `hitl.ts` (R3), the three gates' storage and routing (R4), and a run record for Cursor agents (R12). It would not replace GasCity formulas, the preview workflows, or Doppler.
- AutoApp: nothing we have; its pipeline is a reference for naming R9 states.
- Cookbook `self-hosted-cloud-agent`: a future self-hosted pool, if R2 moves onto our AWS account. Nothing today.
- The six viewers and clients: no existing component. They are reference code for one API client.

## 4. Gap analysis

Available now without building:

- A maintained, tested Cursor Cloud Agent adapter with reattach and PR options (Paperclip, `packages/adapters/cursor-cloud`).
- An approval and question model with addressees and resolver policies (Paperclip).
- Company-scoped membership and grants (Paperclip).
- Terraform for self-hosted worker pools on ECS (Cookbook), subject to Cursor plan limits noted in the Tensorlake README.
- Several small API clients to read when writing our own (AutoApp `lib/cursor/client.ts`, Tower `cursor-api.ts`).

Would still need configuration if Paperclip is adopted:

- One company per Galan organization. A membership per Clerk user, created by us, because Paperclip uses Better Auth and not Clerk.
- One agent row per factory phase with `adapterType: cursor_cloud`, `repoUrl`, and a prompt template.
- Routines or external triggers for the preview label and for GitHub events.

Would still need implementation under any choice:

- The three-phase factory as a workflow artifact (R5, Phase 2). No project has a schema for a task-centric workflow with role gates. AIWG's playbooks are the nearest shape and run only in its own engine.
- Tool contracts over GitHub Actions (R9, Phase 3). AutoApp hardcodes one pipeline; Paperclip has routines, not tool contracts.
- Browser verification as evidence attached to an approval (R10). Nobody has it.
- A bridge from Clerk roles to whichever approval model is used (R3, R4). `hitl.ts` has the rule; Paperclip has the storage. Neither has the other.
- A Cursor event receiver, if Cursor emits webhooks. None of the ten has one; all poll or stream.

## 5. Adoption analysis

### Paperclip as the control plane

Gain: R1, R3, R4, R6, R7, R8, R12 exist and are tested. The adapter registry keeps the coding backend replaceable, which the plan requires.

Still to build: the workflow artifact and generator, tool contracts, preview and verification tools, the Clerk bridge, and every GasCity connection.

Configuration: a company, memberships, agents, routines, `CURSOR_API_KEY` per company, GitHub App for the chat-GitHub services.

Introduced: a second Postgres schema, Better Auth, the Paperclip server on port 3100, its board UI, and its vocabulary. 43 environment variables in `config.ts`.

Preserved: GitHub workflows, Doppler, GasCity, Neon, the Dyad browser bridge, the preview path.

Replaced or refactored: `hitl.ts` constants and storage; the factory-phase chats would need to post into Paperclip issues or be left as-is beside it.

Overhead: a whole product's UI and semantics for a team that wants a factory, not a company of agents. Real, and the largest cost of this option.

Extractable alone: yes. `@paperclipai/adapter-cursor-cloud` depends on `adapter-utils` and `@cursor/sdk`. The approval schema is three tables and a constants file.

### Paperclip adapter only, inside our control plane

Gain: R1 with reattach, PR options, and tests, without the board.

Still to build: everything else in section 4, plus a small host for `ServerAdapterModule` (execution context, session storage, result handling).

Introduced: two npm packages and the SDK.

Overhead: the adapter's contract was designed for heartbeats; we would call `execute` from our own run loop. The alternative is a 200-line client like AutoApp's, which is a day of work and no dependency.

### AutoApp as a pipeline reference

Gain: a working one-repository loop from instruction to merged PR, with Vercel preview and GitHub checks, under Apache-2.0.

Still to build: everything multi-tenant, and a real approval step; it merges on green checks without a person.

Verdict: read it, do not run it.

### Cookbook self-hosted pools

Gain: R2 on our AWS account when Cursor's cloud is not acceptable, using modules Cursor maintains.

Introduced: ECS workers, IAM, and a Cursor plan that allows pools.

Verdict: hold until R2 on Cursor's cloud is shown insufficient. The plan does not require self-hosting in Phase 1.

### AIWG

Gain: prompt content for agent personas and a playbook schema to read before writing ours.

Verdict: do not adopt. It does not reach the Cursor API, and its engine is separate from any control plane.

### The five small clients and viewers

Verdict: reference only. Two have no license file. One is on API v0. One says it will be archived.

## 6. Ranked shortlist

Ranking weighs the ten criteria in the request. Numbers are 1 to 5.

| Rank | Project                 | Alignment | Coverage | Cursor quality | Config without code | Extensible | Tenancy and HITL | Maturity | Integration cost | Ops overhead | Effort saved | Note                                                                              |
| ---- | ----------------------- | --------- | -------- | -------------- | ------------------- | ---------- | ---------------- | -------- | ---------------- | ------------ | ------------ | --------------------------------------------------------------------------------- |
| 1    | Paperclip               | 4         | 5        | 5              | 4                   | 5          | 5                | 5        | 2                | 2            | 5            | Only project with R3, R4, R7 implemented. Cost is its size.                       |
| 2    | Cookbook                | 3         | 2        | 5              | 3                   | 3          | 1                | 4        | 4                | 3            | 2            | Official SDK reference and the only R2 Terraform.                                 |
| 3    | AutoApp                 | 3         | 3        | 4              | 2                   | 3          | 1                | 2        | 4                | 3            | 2            | Best single-pipeline reference. Permissive license. Auto-merge conflicts with R4. |
| 4    | Tensorlake              | 2         | 1        | 4              | 3                   | 2          | 1                | 2        | 3                | 2            | 1            | R2 on one vendor, Enterprise plan for pools.                                      |
| 5    | Agents Control Tower    | 1         | 1        | 3              | 2                   | 2          | 1                | 2        | 5                | 5            | 1            | Clean v0 client with `stop`.                                                      |
| 6    | Herdr Cursor            | 1         | 1        | 4              | 3                   | 1          | 1                | 2        | 4                | 5            | 1            | Named accounts pattern. Declared temporary.                                       |
| 7    | RTS Agents              | 2         | 2        | 3              | 2                   | 2          | 1                | 2        | 2                | 4            | 1            | Multi-provider switch. No license file. Electron-bound.                           |
| 8    | Cursor Cloud Agent MCP  | 1         | 1        | 2              | 1                   | 1          | 1                | 1        | 5                | 5            | 1            | v0, one day of commits.                                                           |
| 9    | Cursor Agents Dashboard | 1         | 1        | 3              | 1                   | 1          | 1                | 1        | 5                | 5            | 1            | Demo. No license file.                                                            |
| 10   | AIWG                    | 1         | 2        | 1              | 4                   | 3          | 1                | 4        | 2                | 3            | 1            | No Cursor API. Content library.                                                   |

Why Paperclip is first and not an automatic yes: it satisfies the largest share of mandatory requirements with verified code and tests, and it keeps the coding backend replaceable. It also brings a second product. The next section narrows what to take.

Why the viewers rank low despite good Cursor clients: the plan's hard requirements are tenancy, role-routed approval, and shared state. A client is a week of work; those three are not.

## 7. Recommended architecture

Two viable shapes. The second is recommended for Phase 1.

**Shape 1. Paperclip as the factory's control plane.** Galan's organization is a Paperclip company. Clerk users are mirrored into `company_memberships`. Each factory phase is a Paperclip agent with the `cursor_cloud` adapter. The three gates become `approvals` with `addresseeUserId` set from Clerk roles. The preview label and GitHub events arrive as routine webhooks. Dyad's factory chats post into Paperclip issues or are replaced by its board.

Cost: two identity systems unless the Clerk bridge is written first, two Postgres schemas, and a board UI the plan did not ask for. This shape is right only if Experiment G finds the plan's workflow artifact can be a Paperclip issue plus routine.

**Shape 2. Our control plane, Paperclip's parts.** Keep Clerk, Neon, `hitl.ts`, GitHub Actions, Doppler, GasCity. Add:

- A Cursor run record: `cursorAgentId`, `latestRunId`, status, PR URL, started by which user and phase. Written by a small v1 client modeled on AutoApp's `lib/cursor/client.ts`, or by hosting `@paperclipai/adapter-cursor-cloud` if its reattach and stream handling prove worth the `adapter-utils` dependency.
- Approval storage copied in shape from Paperclip's `approvals` and `issue_thread_interactions`: type, status, payload, addressee, resolver policy. `GATE_ROLE` already supplies the addressee role.
- The three factory phases unchanged in Phase 1. The workflow artifact comes in Phase 2 from Experiment G, with Paperclip's issue states and AIWG's playbook as the two schemas to read first.
- GitHub Actions stays the preview backend. The tool contract in Phase 3 wraps the existing workflows; AutoApp's state list names the states.
- Self-hosted workers deferred. Cookbook's Terraform is the path if R2 later requires our account.

This shape satisfies R1, R3 for one org, R4, R7, R8, R9, R11, and R12 for Phase 1 with the least new infrastructure: one new table family and one client, no second server, no second auth.

## 8. Next investigation steps

Before committing:

1. **Adapter versus client.** Run Paperclip's `cursor-cloud` adapter's `execute` against a test repository from a 50-line host outside Paperclip. Measure how much of `adapter-utils` it pulls in and whether reattach works. Compare with AutoApp's client on the same task. Decide by lines owned and by whether follow-up and reattach are needed in Phase 1. Feeds Experiment A.
2. **Cursor API capabilities.** From the SDK used by Paperclip and the Cookbook kanban: confirm list, create, follow-up, stop, artifacts, conversation, and whether any webhook exists. All ten projects poll or stream; verify that is the only option. Feeds Experiment A.
3. **Approval schema fit.** Map the three gates in `hitl.ts` onto Paperclip's `approvals` plus `issue_thread_interactions` fields on paper. Note what `visibility: "role"` needs that the addressee model lacks. Feeds Experiment G.
4. **Key scope.** Herdr and Tensorlake both state team admin keys are rejected and pools need a service-account key on an Enterprise plan. Confirm which key type our Cursor plan issues and whether one key per organization is possible. Feeds R11.
5. **Issue as workflow.** Write the factory's three phases as Paperclip issues with routines, and as an AIWG playbook, without running either. Record which fields the plan needs that neither schema has. Feeds Experiment C and G.
6. **Licenses.** Do not copy from RTS Agents, Cursor Agents Dashboard, or the Cookbook until each has a license file in the tree. Paperclip, AIWG, Tower, Herdr, AutoApp, and the MCP project are MIT or Apache-2.0.

No implementation, migration, or modification of this repository is part of these steps.
