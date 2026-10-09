# Galan software factory

Working product playbook. This document freezes the first product, maps what this repo already does onto that model, and lists the experiments that have to pass before the implementation plan is final.

It does not add a generator, a tool registry, or a new agent runtime.

## Frozen for the first iteration

- One project is one primary GitHub repository.
- Cursor Cloud Agent is the coding agent. Cursor Automations is the candidate for event-triggered runs. Galan does not build a coding engine.
- Development infrastructure is assumed to exist. Galan configures and permits it. Galan does not provision a general platform.
- Several humans and several agents work in one project. Projects in different organizations do not see each other.
- The existing human-in-the-loop factory stays: Discovery, then Implementation, then Delivery.
- A customer starts on a preconfigured factory and opens a deeper layer only when the one above is not enough.

## Configuration levels

| Level | What the person edits                                                                         | What they do not edit      |
| ----- | --------------------------------------------------------------------------------------------- | -------------------------- |
| 0     | Nothing. Connect a repository and pick a template.                                            | Workflows, tools, agents   |
| 1     | A workflow: the sequence for one task, including triggers, skills, tools, and who may approve | Tool implementations       |
| 2     | A tool: the operation an agent may call, its inputs, outputs, and permission                  | The workflow that calls it |
| 3     | An agent: responsibilities, instructions, skills, tools, and limits                           | The task sequence          |
| 4     | Coordination: which agent does which part, how work is handed off, when a human is asked      | The task sequence          |

A workflow says what work happens. Coordination says which agents do that work. The same workflow can run on one coding agent or on several specialists.

Each level uses the same interaction: describe the behavior, generate an artifact, edit the text, validate it, publish it. An artifact names other artifacts. It does not copy their definitions.

## Canonical artifact

Shared fields, then a type-specific body. One file format is not required.

| Field               | Meaning                                                |
| ------------------- | ------------------------------------------------------ |
| Name and identifier | Stable id inside the project                           |
| Description         | What it is for                                         |
| Schema version      | Which validator reads it                               |
| Scope               | Organization and project                               |
| Inputs and outputs  | What goes in and what comes back                       |
| Dependencies        | Other artifacts it requires                            |
| Capabilities        | Skills and tools it needs                              |
| Permissions         | Who may run it, and which credentials it may use       |
| Runtime             | Which execution backend, when one is required          |
| References          | Workflows, tools, agents, or coordination it points at |
| Rules               | Validation and how a run proceeds                      |

Type-specific bodies:

- Workflow: trigger, steps, step dependencies, approval conditions.
- Tool: input schema, operation, output schema, credential requirement.
- Agent: instructions, skills, tools, execution limits.
- Coordination: responsibilities, delegation, how context moves, how a task is routed.

## Stack

| Layer                  | Owns                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| Organization           | Organizations, projects, members, roles, ownership                       |
| Human interaction      | Requests, questions, answers, approvals                                  |
| Agent and coordination | The agent a person sees, internal agents, identity, delegation           |
| Workflow               | Task sequences such as discovery, implementation, verification, delivery |
| Skill                  | Reusable procedures an agent follows                                     |
| Tool                   | An operation an agent can invoke                                         |
| Execution              | Where that operation runs                                                |
| Shared state           | Code, work state, context, results, evidence                             |

GitHub Actions is one execution backend. A tool named "deploy preview" keeps the same contract if the backend later changes. A long-running agent that must pause for a person is not a GitHub Actions job, and this plan does not force it into one.

Two questions stay separate. How many agents does a person see? How is every agent's identity, permission, and execution recorded? The second question remains if the person only sees one coordinator.

## What already exists

These rows are the Phase 0 inventory. Paths are in this repository unless noted.

| What exists                                                                                       | Layer today                              | Trigger                                                                                                       | Who acts                                                                                         | Runtime                                                                                      | Credentials                                                         | Result                                                                                        | Human gate                                                                                      | Fits a Galan artifact?                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Factory chats titled Discovery, Implementation, Delivery. `src/lib/factoryPhase.ts`               | Workflow and human interaction           | A person opens the app. Discovery and Delivery start with the assistant. Implementation waits for the person. | One assistant per phase chat. Discovery and Delivery are ask mode. Implementation is build mode. | The Dyad chat, not GitHub Actions                                                            | The app's model provider                                            | A phase summary. Starting the next phase counts as approval of the previous one.              | The summary must be present before approval is offered. The next phase stays locked until then. | The sequence is hardcoded. It is the Level 0 factory, not an editable workflow.                                                                                                                        |
| HITL gates. `src/control_plane/hitl.ts`                                                           | Human interaction and permission         | A bead run reaches `plan-approve`, `review-approve-dev`, or `review-approve-pm`                               | Project manager approves the plan and the final review. Developer approves the technical review. | GasCity bead run, answered through the factory host bridge                                   | Clerk user in one hardcoded organization, `WEWEBPLUS_ORG_ID`        | An answer on the question. The other role can see status and cannot see the body.             | Yes. The target role is the only one who can answer.                                            | The permission rule is real and reusable. The org, the two user ids, and the three step ids are constants.                                                                                             |
| GasCity formulas `discovery.toml`, `implementation.toml`, `delivery.toml`                         | Workflow artifact                        | A person edits a formula page and saves                                                                       | The person. No agent runs the formula from the page.                                             | GasCity compiler on the city host, after `gc formula show`. The page does not cook or sling. | `X-GC-Request` and `X-GC-City-Write` when the city requires a grant | The current file on the city host. One `wewebplus.formula_revisions` row per successful save. | No approval on the page itself                                                                  | Closest Level 1 artifact. Steps have `id`, `title`, `description`, `needs`, and `metadata.gc.run_target`. The schema is GasCity's, not Galan's. Validate does not prove an agent will finish the work. |
| Pull request label `preview`. `.github/workflows/preview.yml` and `deploy/preview/transition.mjs` | Tool trigger                             | Label added or removed, push on a labeled pull request, or the pull request closing                           | GitHub delivers the event. The workflow decides `update`, `destroy`, or `skip`.                  | GitHub-hosted runner, then Devbox `Wewebplus-ci`                                             | `GITHUB_TOKEN`, Doppler, Neon, Namespace                            | A preview on the Devbox, or its removal. Neon branch `preview-pr-<number>`.                   | No                                                                                              | A workflow file plus a label. Not a tool contract. The pull request number is the argument.                                                                                                            |
| `preview-image.yml`, `preview-wake.yml`, `preview-exec.yml`, `preview-secrets.yml`                | Execution, not a tool                    | Push to a branch named in the file. `workflow_dispatch` has no inputs.                                        | Whoever pushes that branch                                                                       | Runner, then Devbox                                                                          | Doppler, Cloudflare, Namespace                                      | An image digest, a woken preview 34, a proof command, or a public key                         | No                                                                                              | The branch name is the command. These do not yet take the arguments a tool would.                                                                                                                      |
| `preview-formula.yml`, `preview-formula-role.yml`                                                 | Execution                                | Push to `cursor/formula-config-ui-55d6`, or a manual run                                                      | Whoever pushes                                                                                   | ECS for the pages. SSH to `13.251.216.187` for the role address.                             | GitHub OIDC role, Doppler, `EC2_SSH_KEY`                            | A load balancer URL. The role ARN stored in Doppler.                                          | No                                                                                              | One-service preview of the formula pages. Not a per-project tool.                                                                                                                                      |
| `gascity-rollout.yml`                                                                             | Execution                                | Push to `cursor/browser-dyad-ui-bbea`, or `workflow_dispatch` with `commit`                                   | Whoever pushes, after `ci.yml` is green for that commit                                          | SSH to the same host, then `gascity-rollout`                                                 | `EC2_SSH_KEY`                                                       | The production city host moved to that commit                                                 | No                                                                                              | The only group-4 workflow that already has an input.                                                                                                                                                   |
| Doppler                                                                                           | Credential store                         | A workflow reads a GitHub secret that Doppler synced                                                          | The workflow, not the person                                                                     | GitHub Actions secret, or Doppler on the host                                                | The service token stays in Doppler                                  | Short-lived use of a secret. Values are not printed.                                          | No                                                                                              | This is the credential backend a tool permission should name, not a tool.                                                                                                                              |
| `.claude/skills` and `rules/`                                                                     | Skill, for the people building Dyad      | A person or an agent in this repo invokes a skill                                                             | The coding agent in the session                                                                  | The agent's own machine                                                                      | The session's GitHub credentials                                    | A code change, a review, or a plan                                                            | Some skills stop for confirmation                                                               | Repo instructions. Not a project-scoped Galan skill.                                                                                                                                                   |
| `plans/axi-toolbox-image.md`                                                                      | Agent-facing GitHub CLI                  | Not built on this branch                                                                                      | An agent in a shell                                                                              | A container with `gh` and `gh-axi`                                                           | `GH_TOKEN` or a mounted `gh` login, supplied at run time            | Dispatch and watch of a workflow                                                              | No                                                                                              | A candidate shell for agents. It does not define tools. Stock `gh-axi` is not where project verbs go.                                                                                                  |
| Cursor Cloud Agent and Cursor Automations                                                         | Not in this repo                         | The person uses Cursor outside Galan                                                                          | The person                                                                                       | Cursor's cloud                                                                               | Cursor's own credentials                                            | A branch and a pull request, in current practice                                              | The person reviews in GitHub                                                                    | No task API, no automation object, and no identity record exist here yet.                                                                                                                              |
| Claude and Codex pull request review workflows                                                    | Execution of a reviewer, not the factory | `pull_request_target` for allowed authors                                                                     | The workflow                                                                                     | GitHub-hosted runner                                                                         | Workflow secrets                                                    | A review comment                                                                              | No                                                                                              | Out of the factory. Do not fold these into the Level 0 template.                                                                                                                                       |

Nothing in the tree is a tool contract, an agent definition, or a coordination artifact. The organization model is one constant org id and two constant user ids.

## Where the artifacts live

Three options. Experiment B picks one. This plan does not.

| Option                            | What the customer repository holds                                                                                               | Cost                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A. Inside the project repository  | Workflow files and Galan artifacts beside the code                                                                               | Updates to a shared tool must be copied into every repository. Customers may not want that clutter. |
| B. Outside the project repository | Application code only. Galan keeps automation elsewhere.                                                                         | The project cannot be replayed from its own repository. Auth and debugging cross two systems.       |
| C. Hybrid                         | The project stores the declarative artifacts. A shared registry stores tool implementations. GitHub Actions remains one backend. | Requires a mapping from project to backend, and a rule for which edits are local.                   |

The current tree is already split: formula text and the preview label live with the project, GasCity and Doppler live outside it, and the GitHub workflow files live in this Dyad repository rather than in each customer app. That is a reason to test C, not a decision to adopt it.

## Identity

GitHub already has organizations, teams, and repository permission. Galan still has to own what GitHub does not express:

- Who may approve a gate without having repository write access.
- Which agent identity a run used.
- Which workflow data a member may see.

`hitl.ts` already does the first of these for two roles, and only inside one organization. Experiment F checks how much of the rest GitHub membership can supply.

## Implementation order

Each phase starts only after the experiment it depends on has a result. Phases 0 and the experiments are the work this playbook authorizes. Phases 1 through 6 are the intended order, not a commitment to build them now.

### Phase 0. Inventory and decisions

The inventory table above is the starting audit. Still to record, from a live Cursor session rather than from this repo: how a cloud agent is started, how an automation fires, and where its transcript and credentials live.

Exit: every row in the inventory table is either "reuse as-is", "wrap as a tool", or "leave out of Galan", and the open decisions below have an experiment named.

### Phase 1. Level 0 factory

One organization, one project manager, one developer, one connected repository. The template installs the Discovery, Implementation, and Delivery sequence, the three HITL gates, and the preview tool. The person does not edit a workflow.

Exit: that repository goes from a request to an approved delivery, including one preview and one rejection, without anyone editing a workflow file. A second organization cannot read the first organization's questions, beads, or preview.

Depends on Experiment A and Experiment G.

### Phase 2. Workflow artifact and generator

The first editable artifact is a workflow. The first examples are the preview label flow and the three-phase factory. The generator may only name tools and skills that already exist.

Exit: a person describes a supported workflow, edits the text, validates it, and runs it, without writing the execution steps.

Depends on Experiment C.

### Phase 3. Tool registry

Existing operations become tools with inputs, outputs, a permission, and a backend. The first backend is GitHub Actions. The first tool is preview deploy. A generator exists only after the registry has the tools the template needs.

Exit: a workflow names `deploy preview` and does not name a workflow file, a branch, or Devbox.

Depends on Experiment B and Experiment D.

### Phase 4. Agent artifact

An agent definition names responsibilities, skills, tools, and limits. The first runtime is Cursor Cloud Agent. Human-facing and internal agents are separate fields even when only one agent is visible.

Exit: changing an agent's tool list changes what it can run, and does not require an edit to the workflow.

Depends on Experiment A and Experiment E.

### Phase 5. Coordination

Run one multi-step task both ways: several agents the person talks to, and one agent the person talks to with the others behind it. Record identity, ownership, and the human gate in both.

Exit: two agents complete one project task, the approval still goes to the role that owns it, and the person can see which agent did which step.

Depends on Experiment E.

### Phase 6. More than one organization

Replace the hardcoded org id and user ids. Keep Galan's gate roles. Use GitHub membership where Experiment F says it is enough.

Exit: two organizations run the Level 0 factory on two repositories, and a member of one cannot read or approve the other.

## Experiments

| Experiment                                | Question                                                                                                                                                                  | Done when                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A. Cursor as the human-facing agent       | Can Galan create a cloud agent task, see its state, continue its context, and start it from an event, without sending the person to Cursor's own UI for the factory path? | A written list of which of those five the API actually allows.                                 |
| B. Preview as a tool                      | The same preview deploy, invoked as one tool, from the project repository, from a separate automation repository, and from a runner that is not GitHub Actions.           | One page comparing setup, credentials, logs, cost, and whether the person can tell what ran.   |
| C. Generate a workflow                    | From a sentence that only uses supported tools, produce an artifact the person can edit, validate, and run.                                                               | The preview-label sentence in the playbook either runs or fails for a named gap in the schema. |
| D. Generate a tool                        | One integration that is not already a workflow. Produce a contract, a permission, and a reviewable implementation.                                                        | A list of what the generator wrote and what a person had to set by hand.                       |
| E. Two human-facing shapes                | The same task with several visible agents, and with one visible agent.                                                                                                    | A comparison of context, how often the person is asked, and whether the gate role still holds. |
| F. GitHub as the org directory            | Membership, teams, and repository permission against the HITL rules.                                                                                                      | Which of the three identity gaps above GitHub covers, and which Galan still stores.            |
| G. Express current workflows as artifacts | Factory phases, the three gates, the preview label, and one formula file.                                                                                                 | Each one marked reuse, wrap, or leave out, with the field it cannot express.                   |

A and G can run at the same time. B can run at the same time as A. C waits on a draft workflow schema from G. D waits on B. E waits on A. F can run at the same time as G.

## Decisions still open

- Model A or Model B for the agent a person sees. Experiment E.
- Option A, B, or C for where artifacts live. Experiment B is the evidence. The current split is a hint toward C, not a choice.
- Whether Cursor Automations can start a factory run. Experiment A. If it cannot, the trigger stays a GitHub event and Galan records the run.
- The workflow schema. Experiment G writes the first draft from the factory phases and the preview label. Experiment C is the test of that draft.

## What you can check in this document

1. Every inventory row names a file, a function, or a workflow that is in the tree, or it says the thing is not in the repo.
2. The three HITL gates match `GATE_ROLE` in `src/control_plane/hitl.ts`: plan to the project manager, technical review to the developer, final review to the project manager.
3. No phase in this document asks for a new coding agent, a new CI system, or a general provisioning layer.
4. Phases 1 through 6 each name the experiment they wait on.

## What you do

1. Confirm the frozen scope and the Level 0 through Level 4 split.
2. Choose the first experiments to run. A, B, and G are the ones that do not depend on each other.
3. After those three, accept or replace the working hypothesis that project artifacts stay in the repository and tool implementations stay in a shared registry.

## Out of scope

- Building the generators, the registry, or the organization tables.
- Editing the formula pages, the preview workflows, or the GasCity host.
- Replacing Cursor, GitHub Actions, Doppler, or GasCity.
- A factory template for stacks other than the one this repo already runs.
- Folding the Claude and Codex review workflows into the product.
- Provisioning infrastructure for a new customer.
