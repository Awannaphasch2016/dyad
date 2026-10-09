# Paperclip as an orchestration backend beside GasCity

Investigation of whether Paperclip can sit under the existing web builder as another orchestration backend, without replacing GasCity. Source was read from the Paperclip clone at the commit present on 2026-10-09 and from this repository. Nothing in the running factory, the production city host, or the formula save path changes.

## What you can check

- Paperclip has a project inside a company: `packages/db/src/schema/projects.ts` (`companyId`, `leadAgentId`, `goalId`) and `packages/db/src/schema/project_workspaces.ts` (`repoUrl`, `repoRef`).
- Humans and agents share one membership table: `company_memberships.principalType` is `user | agent` (`packages/shared/src/constants.ts` line 958).
- The org chart is agents only: `agents.reportsTo` references `agents.id` (`packages/db/src/schema/agents.ts` line 28).
- This repository has no Cassidy module. The orchestration surfaces here are the GasCity formula client, the factory host, and the HITL tables.
- This environment has no Docker, so the experiment below is specified and not executed.

## What this adds

A comparison and the smallest experiment that would show a Paperclip issue in the existing UI. No application code.

## What you do

Read the comparison, then run the experiment on a machine that can start Paperclip's own Compose project. Do not point it at the production city host.

## Out of scope

- Replacing GasCity, the formula pages, `gascity-rollout.yml`, or the factory host.
- Wiring Clerk into Paperclip.
- Multi-tenant HITL as a product. Section 4 only classifies what already exists.
- Booting Paperclip on `13.251.216.187` or against Neon `wewebplus.*`.

## 1. How the two models line up

GasCity, as this repository uses it:

| Idea         | Where it lives                                                                                                  | What it is                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Organization | `GAS_CITY_CITY_NAME`, path `/v0/city/{city}/formulas/{phase}` in `src/lib/formula/gascity_formula_client.ts`    | One city name. The formula client refuses any other city string.                                                |
| Project      | `apps.gas_city_project_id` in `src/db/schema.ts`, set by `linkFactoryApp` in `src/main/factory_host_service.ts` | A string on the Dyad app. The formula pages do not read it.                                                     |
| Workflow     | Formula TOML for `discovery`, `implementation`, `delivery` (`src/lib/formula/phases.ts`)                        | Steps with `id`, `title`, `description`, `needs`. The page validates and saves text. It does not cook or sling. |
| Task         | GasCity beads, created later by a cook on the city host                                                         | Absent from the formula page. The factory host stores its own runs in `factory_host_runs`.                      |
| Human gate   | `GATE_ROLE` and `hitl_questions` in `src/control_plane/hitl.ts`                                                 | Our table. Target is a role (`project-manager` or `developer`), visibility `role`.                              |
| Identity     | Clerk. `WEWEBPLUS_ORG_ID` and two user ids are constants in `hitl.ts`. Roles in `src/lib/adminAccess.ts`.       | One organization.                                                                                               |

Cassidy is not in this tree. A search of `src/`, `plans/`, and `docs/` finds no Cassidy module, client, or config. Whatever Cassidy does for orchestration lives outside this repository, so this comparison cannot credit it with behavior.

Paperclip, from schema and routes:

| Idea         | Where it lives                                      | What it is                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization | `companies` (`packages/db/src/schema/companies.ts`) | The tenant. `assertCompanyAccess` in `server/src/routes/authz.ts` rejects an agent key whose `companyId` differs, and a board user who is not a member.                                                                                |
| Project      | `projects` plus `project_workspaces`                | A named deliverable inside one company, with status, a lead agent, and a workspace that stores `repoUrl` and `repoRef`. `POST /api/companies/{companyId}/projects` accepts that workspace inline (`docs/api/goals-and-projects.md`).   |
| Goal         | `goals`, optional `projects.goalId`                 | A separate hierarchy (company, team, agent). A project can name one.                                                                                                                                                                   |
| Agent        | `agents`                                            | Belongs to one company. `role` is a job label: `ceo`, `cto`, `engineer`, `pm`, `qa`, `general`, and the rest of `AGENT_ROLES`. `reportsTo` is another agent in the same company. `adapterType` and `adapterConfig` choose the runtime. |
| Task         | `issues`                                            | Belongs to one company and optionally one `projectId`. Statuses are `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. `parentId` makes a tree. Checkout is `POST /api/issues/{issueId}/checkout`.         |
| Workflow     | `routines`, `routine_triggers`, `routine_runs`      | A trigger (cron or webhook) that enqueues one issue for one `assigneeAgentId`. A revision stores a snapshot. This is not a step graph with `needs`.                                                                                    |
| Run          | `heartbeat_runs`                                    | The agent's execution of an issue. The UI lists it; completion comes from the adapter stream, not from a webhook.                                                                                                                      |

The shared shape is: a tenant contains agents and units of work, and work can name a repository. The split is the workflow. GasCity's formula is a step graph compiled on the city host. Paperclip's routine is a trigger that creates an issue. Paperclip's durable workflow state is the issue tree, not a formula file.

A Dyad app is closer to a Paperclip project than to a Paperclip company. The company lines up with the Clerk organization. The GasCity city is that same boundary, with one city in the current deployment.

## 2. Humans in Paperclip's permission model

Paperclip already has human principals. They are not an extension we would have to invent.

Three different fields are called a role:

| Field                                | Values                                                                                             | Who it applies to                 | What it authorizes                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `agents.role`                        | `ceo`, `engineer`, `pm`, …                                                                         | Agents                            | A label. The one authorization use found is `canCreateAgentsLegacy`: a `ceo` may create agents (`server/src/services/authorization.ts`). |
| `company_memberships.membershipRole` | Humans: `owner`, `admin`, `operator`, `viewer`. Stored value `member` is normalized to `operator`. | `principalType` `user` or `agent` | Default permission keys from `grantsForHumanRole` in `server/src/services/company-member-roles.ts`. A viewer is read-only (`authz.ts`).  |
| `instance_user_roles.role`           | `instance_admin`                                                                                   | Users                             | Instance-wide. Not a company role.                                                                                                       |

`principal_permission_grants` rows are `(companyId, principalType, principalId, permissionKey, scope)`. `principalType` is `user` or `agent`, so the same grant table covers both. `setMemberPermissions` in `server/src/services/access.ts` writes those rows for a membership of either type. Permission keys include `tasks:assign`, `tasks:assign_scope`, `joins:approve`, `agents:create`, `users:manage_permissions`. They do not include `approve-discovery` or `project-manager`.

Humans and agents already share:

- Company membership, with the same status values (`pending`, `active`, `suspended`, `archived`).
- The grant table.
- Issue assignment. `issues.assigneeAgentId` and `issues.assigneeUserId` are separate columns, each indexed.
- Issue comments (`authorType` `user | agent | system`).
- Issue-thread interactions. `addresseeUserId` and `addresseeAgentId` are both columns. `resolvedByUserId` and `resolvedByAgentId` too.
- Approvals. `approvals.requestedByUserId` and `requestedByAgentId`; `decidedByUserId` records the human decision.

They do not share the org chart. `reportsTo` cannot point at a user. A human appears on an issue as `assigneeUserId`, `responsibleUserId`, or `createdByUserId`.

Approval and intervention that already exist:

| Mechanism                   | What it does                                                                                                            | How a human is chosen                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_thread_interactions` | `ask_user_questions`, `request_confirmation`, `request_checkbox_confirmation`, `request_item_verdicts`, `suggest_tasks` | `addresseeUserId` is one user. Resolver policy is `anyone`, `not_creator`, or `human_only`. Company `interactionResolverGovernance` can narrow that policy. It cannot name a role. |
| `approvals`                 | Types such as hire-agent and budget override. Board routes call `assertBoard`.                                          | `decidedByUserId`. Not routed by role.                                                                                                                                             |
| `joins`                     | `JOIN_REQUEST_TYPES` are `human` and `agent`, status `pending_approval`.                                                | `joins:approve` grant.                                                                                                                                                             |
| Delegation                  | `tasks:assign` and `tasks:assign_scope` (scope can be `subtreeRootAgentId`)                                             | A grant on a principal. The subtree is an agent tree.                                                                                                                              |

What we could use as-is:

- Company as the tenant boundary, including the cross-tenant 404 behavior in `hasCompanyAccess`.
- Membership and grants for humans who log into Paperclip.
- Creating an issue, assigning it to an agent or a user, commenting, and reading status (`docs/api/issues.md`).
- A confirmation or question card with `human_only`, addressed to one user id.
- A project plus workspace as the place a repository is attached.
- Heartbeat runs as the execution record.

What we would still implement:

- A bridge from a Clerk user to a Paperclip user id. Paperclip's board login is Better Auth (`server/src/auth/better-auth.ts`). Clerk is not read.
- A map from our `project-manager` and `developer` roles onto Paperclip user ids. The interaction addressee is a user, and the membership role is owner/admin/operator/viewer. `GATE_ROLE` has no column to land in.
- The three-phase formula. A routine does not encode `needs` between discovery, implementation, and delivery.
- Showing a Paperclip issue inside the Dyad formula or factory page. Paperclip has its own board UI on port 3100.

Reusing the membership table does not remove `hitl.ts`. It gives us storage and an addressee. The role rule stays ours until a bridge writes `addresseeUserId` from `GATE_ROLE`.

## 3. Smallest experiment

Goal: one orchestration task created through the existing Dyad UI, executed by a Paperclip agent, and shown back on that page. GasCity keeps serving formula text.

### Where it runs

Paperclip's Compose file `docker/docker-compose.yml` starts Postgres 17 and the server on port 3100, with its own volume. Set `PAPERCLIP_DEPLOYMENT_MODE=local_trusted` only for this Compose project, bound to `127.0.0.1`. In that mode `actorMiddleware` treats every request as the local board (`server/src/middleware/auth.ts`). Do not use `local_trusted` on a reachable host. The authenticated mode, with a board API key from `server/src/services/board-auth.ts`, is the follow-up once the loop works.

This VM has no Docker. The experiment is not run here. It also must not run on the production city host.

### What Dyad would gain, and only when configured

A main-process client next to `gascity_formula_client.ts`, with an injectable fetch, reading:

- `PAPERCLIP_API_URL` (default unset)
- `PAPERCLIP_COMPANY_ID`
- `PAPERCLIP_AGENT_ID`
- `PAPERCLIP_API_KEY` empty in `local_trusted`, required otherwise

When any of the first three is missing, the client returns "not configured" and the page renders exactly as it does today.

Two IPC channels, same shape as `factory-host:get-state`:

- `paperclip:create-probe-issue` → `POST /api/companies/{companyId}/issues` with title `Dyad probe {appId}`, `status: "todo"`, `assigneeAgentId`, `projectId` when one was created for the app.
- `paperclip:get-issue` → `GET /api/issues/{issueId}`.

The formula page (`src/pages/formula.tsx`) shows the returned `identifier` and `status` under the editor. It does not write formula text, a bead, or `factory_phase_approvals`.

The agent for the probe is one Paperclip agent in that company whose adapter echoes a comment and sets the issue to `done`. A Cursor Cloud adapter is a later swap of `adapterType` on that same row. The first run does not need a Cursor key, and it does not cook a formula.

### Acceptance

1. With `PAPERCLIP_*` unset, `src/lib/formula/gascity_formula_client.test.ts` and the formula page tests pass, and a save still calls only `/v0/city/{city}/formulas/{phase}`.
2. With the local Paperclip running, the page creates one issue and then shows its identifier and a status that moves from `todo` to `in_progress` to `done` after the echo agent runs.
3. The GasCity supervisor URL receives no request from the probe.
4. `gascity-rollout.yml` is not dispatched.
5. A company id other than `PAPERCLIP_COMPANY_ID` is not sent. The client always puts the configured company id on the path.
6. Stopping the Paperclip process leaves the formula editor usable and shows the probe as unavailable.

### What this experiment does not answer

It does not show role-routed approval, Clerk login, a formula compiled into issues, or a second organization. Those stay in section 4.

## 4. Multi-tenant HITL, classified

| Need                                      | Already in Paperclip                                                                               | Extend                                                 | Build                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Several organizations, isolated           | Company row, membership, `assertCompanyAccess`, agent key bound to one company                     | One company per Clerk org                              | The Clerk-to-company link, and a rule that a Dyad app's `gasCityProjectId` and Paperclip `projectId` stay in the same org |
| Several humans with different permissions | `owner`, `admin`, `operator`, `viewer` plus per-principal grants                                   | Grant rows for each Clerk user after the bridge exists | Our `project-manager` and `developer` permissions (`approve-discovery`, `work-implementation`)                            |
| Humans and agents in one workflow         | Issue assignee, comments, interactions, approvals                                                  | Address a confirmation at `addresseeUserId`            | Putting a human in `reportsTo`                                                                                            |
| Role-specific approval routing            | `human_only` and a single addressee user                                                           | Company governance can narrow the resolver policy      | Routing by role. The addressee column is a user id                                                                        |
| Shared project state                      | Issues, documents, heartbeat runs, routine runs, all keyed by `companyId` and optional `projectId` | One Paperclip project per Dyad app                     | Syncing that state into `hitl_questions` and the factory chats                                                            |
| Organization-level workflow configuration | Routines and agent instruction revisions per company                                               | One routine per phase trigger                          | A step graph with `needs`. Routines do not store one                                                                      |

## 5. Comparison

|                                        | GasCity, as this repo uses it                                                 | Paperclip                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant                                 | City name on the supervisor URL                                               | `companies` row, enforced on every route                                                                                                    |
| Project                                | `gas_city_project_id` string on the app                                       | `projects` plus a workspace with `repoUrl`                                                                                                  |
| Workflow artifact                      | Formula TOML, three phases, steps and `needs`                                 | Routine trigger that creates one issue. Issue tree for breakdown                                                                            |
| Who may approve                        | Our `GATE_ROLE`, stored in `hitl_questions`                                   | A named user, or any human when policy is `human_only`                                                                                      |
| Permission model                       | Clerk org plus two hardcoded user ids and two roles                           | Membership role, grant keys, agent job label                                                                                                |
| Humans beside agents                   | Humans live in Clerk and the HITL table. Agents live in the city              | Same membership and grant tables. Separate org chart                                                                                        |
| Execution record                       | Factory host runs, GitHub Actions logs, beads on the host                     | `heartbeat_runs` and issue status                                                                                                           |
| Fit to the current UI                  | The formula page already speaks its API                                       | Needs the client in section 3. Its own board UI is a separate server                                                                        |
| Custom work to reach the Galan factory | Keep the formula, add a Cursor run record, generalize the two hardcoded users | Bridge Clerk, map the two roles onto user ids, and express the three phases as issues. The permission and approval tables are already there |

Paperclip is a viable second backend for "create a task, run an agent, show the status" once the section 3 loop passes. It is not a drop-in replacement for the formula file or for `GATE_ROLE`. The membership and interaction tables are the part worth adopting; the company vocabulary and Better Auth are the part to leave on the other side of a small client.
