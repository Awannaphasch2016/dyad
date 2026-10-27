# Vibe SDK minimal host

This is the handoff plan for the selected Vibe SDK feature set. The branch that carries it consolidates the kept preview patches and stops. It does not add the Docker behavior. Review this plan before any further implementation.

The older swarm plan in [plans/vibesdk-agent-hitl.md](vibesdk-agent-hitl.md) is superseded for this selection. Its scripted-agent proof is not the selected design.

## Locked decisions

- The only typing place is the Vibe SDK prompt box that already exists. A reply is the next user message on the existing `USER_SUGGESTION` websocket path. There is no second text field.
- Only the Project Manager can create an app. The server gate is `assertProjectManager`. The home screen also returns early when the shared session role contains `Developer`, so a Developer press of Enter does not navigate into a new chat. The server gate is the one that counts.
- There is no private app. An app row stores `org_id` and `created_by`. Creating records who used the permission. It does not confer belonging. Either member of that organization can open the app (`memberCanAccessApp`). Until `org_id` is set, only the Project Manager can connect.
- Roles are read from `wewebplus.memberships` (`org_id`, `role_id` for the Clerk user id). Exactly one `project-manager` or `developer` row is usable. Shared `wewebplus` tables are not altered. This run's app, question, and answer rows live in the preview's own D1 database.
- One question is open at a time. An unnamed or unknown role is stored as `project-manager` with `assignment = 'fallback'`. Requirements and UX go to the Project Manager. Files, code, and technical choices go to the Developer.
- The named role sees the question body. The other role sees one waiting line, `Waiting on the Project Manager.` or `Waiting on the Developer.`, and does not see the body. One answer is stored once. A second answer does not resume the run.
- The accepted answer is the next user message. That message starts the next run unit.
- Think stays the default behavior, as the pin wrote it. This branch does not retarget Think at OpenRouter, does not change the preview iframe, and does not add a static-site deploy.
- The Docker agent is a fourth behavior, selected in `CodeGeneratorAgent`, sibling of `ThinkCodingBehavior`. It is not a mode inside `ThinkAgent`. One container execution replaces the single `stub.chat()` call. The host does not evaluate model output to choose a next phase, and it does not wrap the container in the later eight-call bead loop.
- Both browsers share one `CodeGeneratorAgent` and one `SpaceDO`. The editor file list is the shared generated code. There is no fleet type.
- Electron, Gas City formula files, hitl-web, Bolt, phase permissions, Discovery/Implementation/Delivery, Continue, and the phase-approval button stay out. Do not vendor upstream methodology skills. The host does not run `gc`.

## What this branch contains

Pin: `VIBESDK_SHA` in `deploy/preview/vibesdk.mjs` is `9da158d82c597a0e8f4bf033cdccd1053fb6fb15` (`https://github.com/cloudflare/vibesdk.git`). Deploy-time patches apply onto a detached checkout of that commit. This repository does not contain the Vibe SDK source.

Kept from the organization snapshot (the commit that let organization members open the app without making the creator the owner), plus the shared-auth preview that snapshot already sat on:

- `deploy/preview/vibesdk.mjs` — preview names, Wrangler config, lab and production refusal, and `patchWorkerExports` (drops the `UserAppSandboxService` export). No model patch.
- `deploy/preview/vibesdk-preview.mjs` — clone the pin, drop the sandbox export, apply Clerk shared sign-in, apply the organization run, deploy the per-PR worker. Think is logged as `think_behavior=upstream`. The worker does not receive `OPENROUTER_API_KEY`.
- `deploy/preview/vibesdk-shared-auth.mjs` — Clerk session already used by the preview. The role is stored as `vibesdk-shared-role` and removed on sign-out. Later session keys for the account name and the organization name are not included.
- `deploy/preview/vibesdk-org-run.mjs` — organization schema, membership read, create gate, question and answer rows, role filter, and the temporary Think intercept described below.
- `deploy/preview/vibesdk-cloudflare.mjs` — per-PR D1, KV, and R2. Lab and production ids are refused.
- `deploy/preview/clerk-origins.mjs` — allow the preview `workers.dev` origin. The lab host is not added.
- `deploy/preview/transition.mjs` — `preview-vibesdk` is its own label. The Dyad `preview` label does not deploy this worker.
- `.github/workflows/preview-vibesdk.yml` — deploy and destroy. The two-browser job is still gated on branch `cursor/vibesdk-org-belonging-0539`, so this branch does not run it.
- `e2e-vibesdk/` — two browsers, walkthrough Project Manager and Developer. `OPENROUTER_API_KEY` is used only by `answerQuestion` in `e2e-vibesdk/tests/two-roles.spec.js`, which reads the question that appeared and types the reply into the prompt box. Playwright does not memorize the question.
- `scripts/doppler/vibesdk-hitl-accounts.mjs` — looks up the existing walkthrough accounts. Do not seed a second pair. Do not modify the human Google or Microsoft accounts.

`package.json` runs `deploy/preview/vibesdk-org-run.test.mjs` in the `node --test` list, before Vitest.

## What this branch removed

These were on the organization snapshot and are not selected:

- `patchThinkModel` and `patchThinkRouting`. Think is not rewritten to `anthropic/claude-sonnet-4.5` on OpenRouter, and `directOverride` is not injected. The routing patch's insertion of `configureThinkAgent()` at the start of `build()` is gone with it. The pin still configures Think from `initialize`. Organization `patchThink` does not add another `configureThinkAgent` call.
- `OPENROUTER_API_KEY` as a worker secret. The e2e answerer still reads that key from the job environment.
- `patchAppCreationLimit`. The pin's app-creation cap stays.
- `patchStaticSiteDeploy`, `patchPreviewServing`, `commitHasAppClass`, `collectStaticWebAssets`, and `previewProbeDecision`. A generated site is not rewritten into `__vibesdk_static_site__`.
- `patchPreviewPane`. The preview iframe keeps the pin's retry behavior.

## What was not brought forward

| Source                                                                                     | Left out                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scripted question card                                                                     | The scripted agent and its card.                                                                                                                                           |
| Named-turn and avatar PRs                                                                  | Account-name chat labels, avatars, the Orange card, and the "Response required" panel.                                                                                     |
| Owed `generate_all`                                                                        | The pin already sends `generate_all` from the websocket after the handshake.                                                                                               |
| Session-scope PR                                                                           | Clearing organization UI state on app switch, and the extra shared-session keys. The header chip from shared auth stays.                                                   |
| Methodology catalog through the one-shop run                                               | Step catalogs, write-before-ask, the eight-call bead loop, narration stripping, Spec Kit recordings, shop-preview gating, preview-retry changes, and saved-website deploy. |
| Lab worker, Doppler project setup, Forma key copy, Bolt, Gas City formulas, Dyad phase bar | Out of this product.                                                                                                                                                       |

## Behavior that is implemented today

`applyOrganizationRun` writes `worker/services/org/run.ts` onto the pin and patches the files listed at the bottom of `deploy/preview/vibesdk-org-run.mjs`.

D1 statements, applied idempotently on the preview database only:

```sql
ALTER TABLE apps ADD COLUMN org_id TEXT
ALTER TABLE apps ADD COLUMN created_by TEXT
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  target_role_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  assignment TEXT NOT NULL,
  created_at INTEGER NOT NULL
)
CREATE TABLE IF NOT EXISTS answers (
  question_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
)
```

`answers.question_id` is the primary key, so a second insert fails and `acceptOrganizationAnswer` returns `This question already has an answer.` The question status moves to `answered` only after that insert.

Membership query, read-only:

```sql
select org_id, role_id from wewebplus.memberships where user_id = $1
```

Create: `assertProjectManager` on the agent create controller, then `claimOrganizationApp` sets `org_id` and `created_by`. Open and socket: `memberCanAccessApp` and `authorizeOrganizationSocket`. A different organization gets 404. A non-member gets 403.

Question path while Think is still the behavior that asks:

1. `patchAskQuestionsTool` adds optional `targetRole` to the pin's `ask_questions` tool.
2. `patchThink` changes the clarify prompt to exactly one question and, inside the tool-output branch of the stream, calls `publishOrganizationQuestion` and returns. It does not broadcast that tool call on the normal path.
3. `publishOrganizationQuestion` stores one open row and sends the body only to sockets whose `x-org-role` matches. Other sockets get the waiting line.
4. `patchWebsocket` runs `acceptOrganizationAnswer` before `handleUserInput`. A refusal sends the waiting line and does not start a run. An acceptance lets the existing `USER_SUGGESTION` path queue the text.
5. `redactConversation` strips a hidden body from transcript state sent to the other role.

`patchThink` also holds streaming text until the turn ends, drops reasoning deltas, and suppresses the final text while `organizationHold` is set. That is part of this temporary intercept, not a separate product feature. Deleting `patchThink` in the cleanup step below removes it.

Presentation on this branch: the named role sees the body in the existing clarifying-question slot (`data-testid="org-question"`) with the line `Reply in the prompt box.` The slot has no input. The other role sees `data-testid="org-waiting"`. See the review note below if that slot should become a transcript message instead.

## Gallery and delete refusal (review this)

`patchAppService` sets `isOwner: mayOpen` so either member can open the app, forces the header owner flag off, returns no visibility icon, skips the private-visibility 404 for an organization member, and refuses both gallery changes (`Changing the gallery flag is not available.`) and delete (`Deleting an app is not available.`). The two-browser spec asserts that neither role sees `Make public`.

This is included because it is how that snapshot kept `created_by` from becoming the owner. It was not a separate confirmation of the gallery UI. If gallery controls should come back, reject this part and update `patchAppService` plus the `Make public` assertions in `e2e-vibesdk/tests/two-roles.spec.js`. Do not reinterpret `visibility` as belonging. `visibility` remains the pin's gallery flag. GitHub repository visibility is a different column.

## Question slot (review this)

The selected rule is: the named role sees the body, the other role sees one waiting line, and the reply is typed in the prompt box. This branch shows the body in the clarifying-question slot above the box. Later Orange cards and `Response required` were not brought forward.

If the body must be a builder transcript message and the slot must go, change `publishOrganizationQuestion` to send the body as the chat message for the named role, delete the popup rewrite, and point `questionText` in the e2e at that message. Do not add a field.

## Why Think cannot be the Docker integration point

Verified on the pin:

- `BehaviorType` is `'phasic' | 'agentic' | 'think'` in `worker/agents/core/types.ts`.
- `CodeGeneratorAgent` startup in `worker/agents/core/codingAgent.ts` chooses the behavior: `behaviorType` from props, else a persisted `phasic` | `agentic` | `think` value, else `getBehaviorTypeForProject(projectType)`. `phasic` constructs `PhasicCodingBehavior`. `think` constructs `ThinkCodingBehavior`. Anything else constructs `AgenticCodingBehavior`.
- Project type `app` defaults to `think` in `DEFAULT_FEATURE_DEFINITIONS` (`worker/agents/core/features/types.ts`). Leave that default. Docker is selected only when `behaviorType` is `docker`.
- `ThinkAgent` (`worker/agents/think/ThinkAgent.ts`) extends `@cloudflare/think`. It has no `build()` and does not choose behaviors. `maxSteps = 25` stays inside the Think package.
- `ThinkCodingBehavior.build()` only drains `pendingUserInputs`. It stops when the queue is empty or `runPrompt` throws. `generateAllFiles` calls `build()` once. It is not a "run N times" setting.
- `runPrompt` is the single `stub.chat(text, forwarder)` call. That is the run unit a container replaces.
- `ask_questions` in the pin is a no-op that returns JSON. The host sees it on the stream. The model's next user message is the answer. The host does not cancel `chat()` when the tool runs.
- One app is one `CodeGeneratorAgent`, one Think durable object when the behavior is Think, and one `SpaceDO` keyed by the agent id. The durable object name is the app id. It is not an implementation selector.
- Inputs that exist today are the user text (`state.query` / `USER_SUGGESTION`) and the optional `behaviorType`. No image, harness URL, or spec object is passed.

The methodology outer loop of up to eight `chat()` calls is not on this branch. Do not add it around the container.

`previewWranglerConfig` refuses `containers`, `dispatch_namespaces`, `ai`, `browser`, and a `UserAppSandboxService` binding. A Cloudflare Container binding for the builder would have to change that refusal. Do not relax it in order to host the generated-app sandbox.

## Remaining work: Docker behavior

Add `deploy/preview/vibesdk-docker-behavior.mjs`. Apply it from `provisionPreview` in `deploy/preview/vibesdk-preview.mjs` after `applyOrganizationRun`. Do not edit the pin inside this repository. Read the pin at `VIBESDK_SHA` before writing anchors; the patch must throw if an anchor is missing, the same way `requireAnchor` does in the organization module.

### 1. Extend the behavior union

Patch `worker/agents/core/types.ts` so `BehaviorType` includes `'docker'`.

Patch the startup `if` / `else` in `worker/agents/core/codingAgent.ts`:

- `phasic` → `PhasicCodingBehavior`
- `think` → `ThinkCodingBehavior`
- `docker` → `DockerCodingBehavior`
- otherwise → `AgenticCodingBehavior`

Persist `docker` the same way the other three values are persisted. Do not change the `app` default away from `think`. A caller opts in by passing `behaviorType: 'docker'` when the agent is created. `getConversationMessageLoader` can keep the Think loader for `think` only. Docker transcript messages are the host broadcasts already used by `runPrompt` (the streaming conversation response). Do not read them from the Think durable object.

### 2. Add `DockerCodingBehavior`

New file on the pin, sibling of `worker/agents/core/behaviors/think.ts`. Extend the same coding-behavior base Think extends, so `generateAllFiles` → `buildWrapper` → `build()` still drains the queue.

Replace the body of `runPrompt` (or override `runPrompt`) with one harness call. Do not call `stub.chat`. Do not construct `ThinkAgent`. Do not loop.

Suggested request from the host to the harness:

```json
{
  "appId": "<agent id>",
  "text": "<the queued user message>"
}
```

`text` is `state.query` on the first build, and the accepted prompt-box message on every later build. The host does not send a phase name.

Suggested response:

```json
{
  "status": "completed",
  "files": [{ "path": "src/App.tsx", "contents": "..." }]
}
```

or:

```json
{
  "status": "waiting",
  "files": [],
  "waiting": {
    "targetRole": "project-manager",
    "body": "What is the shop called?",
    "assignment": "declared"
  }
}
```

`status` is only `completed` or `waiting`. `targetRole` is `project-manager` or `developer`. Omit `targetRole` to mean fallback: the host's existing `assignRole` stores `project-manager` and `assignment = 'fallback'`. When the harness sends `assignment`, persist that value; do not invent a third role.

The harness owns its model and tool loop. The host waits for this one response and then returns from `runPrompt`. A `waiting` result ends the run unit. The next `USER_SUGGESTION` that `acceptOrganizationAnswer` allows is the next request's `text`.

### 3. Where the harness runs

Prefer an HTTPS endpoint configured on the preview worker (a var such as `DOCKER_HARNESS_URL`), called once per `runPrompt`. That does not require a `containers` binding, so the resource refusal in `previewWranglerConfig` stays.

Use a Cloudflare Container binding only if the harness must run as a container on this account. That choice changes `previewConfigViolations` to allow that one binding. It must still refuse `UserAppSandboxService`, lab names, production names, and `build.cloudflare.dev`. Do not point the binding at the lab worker.

The image and the endpoint are not in this repository. Supply them outside the pin. Do not copy shared Cloudflare tokens from Gas City, Dyad preview, Bolt, or Forma into a new use, and do not print secrets.

### 4. Write files into the shared project

On every result, write `files` into the app's `SpaceDO` before broadcasting success. Use the same workspace RPCs the pin's Think write tool uses (`worker/agents/think/space-workspace-ops.ts`, reached from the write tool in `ThinkAgent`). Read those functions on the pin and call them. Do not add a second file store.

Empty `files` is valid for a question-only result. The editor file list is the shared view. Do not patch `preview-iframe.tsx`. Do not call `deploy_space` from the host. A sandbox preview of the generated site is out of this selection.

### 5. Ask through the host, then delete the Think intercept

For `status: "waiting"`:

1. Call `publishOrganizationQuestion` with `args` shaped as `{ questions: [{ question: waiting.body, targetRole: waiting.targetRole }] }`.
2. Return from `runPrompt`. Do not call the harness again.

`acceptOrganizationAnswer` and `patchWebsocket` already turn the next prompt-box message into the next run unit and reject the other role and a second answer. Leave that gate on the host. Do not put the role check inside the container.

After the Docker behavior is the path that asks, delete:

- `patchThink`
- `patchAskQuestionsTool`
- the `worker/agents/core/behaviors/think.ts` and `worker/agents/think/ask-questions-tool.ts` entries in `applyOrganizationRun`

Default Think is then the pin plus no question intercept. Keep `publishOrganizationQuestion`, `acceptOrganizationAnswer`, `redactConversation`, and the websocket gate. They are host behavior, not Think behavior.

Until that deletion, a Think run can still ask, and a Docker run must not double-publish. Only the behavior that is actually selected may call `publishOrganizationQuestion`.

### 6. Select it for a run

Leave `DEFAULT_FEATURE_DEFINITIONS.app.behaviorType` as `think`. Pass `behaviorType: 'docker'` from the create path when the Docker proof should run. Do not switch every app to Docker by editing the default until that proof has been reviewed.

### 7. Two-browser check

`e2e-vibesdk/tests/two-roles.spec.js` is the harness to keep:

- Developer Enter on the home box does not open `/chat/`.
- Project Manager Enter does.
- The Developer opens that app from the sidebar.
- The two roles never both see a question body.
- The listener sees `org-waiting` and does not see the body text.
- The speaker's reply is typed into the prompt box.
- `OPENROUTER_API_KEY` is only the answerer.

The job in `.github/workflows/preview-vibesdk.yml` (`hitl`) still requires `github.event.pull_request.head.ref == 'cursor/vibesdk-org-belonging-0539'`. Change that to the implementation branch only when the selected behavior can finish a question. On this branch it must stay gated off.

This preview does not set `CLOUDFLARE_AI_GATEWAY` (`previewConfigViolations` rejects it) and does not inject an OpenRouter key. Unpatched Think uses the pin's model (Gemini through AI Gateway). A live Think question on this preview will fail closed until those credentials are deliberately configured, or until Docker replaces `stub.chat`. Do not restore `patchThinkModel` to make the check pass.

The answerer key in the e2e job comes from the Doppler `dyad` / `preview` fetch already in that job. It is not a worker secret. Do not copy Clerk keys into the Doppler `vibesdk` / `dev` config.

## Verification already run for this branch

From the repository root:

```sh
node --test deploy/preview/vibesdk.test.mjs deploy/preview/vibesdk-org-run.test.mjs deploy/preview/clerk-origins.test.mjs
```

Those tests cover resource refusal, the absence of the removed patches, the organization role rules, and Clerk origin allowlisting. They do not deploy a worker and they do not start a browser.

## Out of scope for the implementer as well

- Altering `wewebplus.apps` or `wewebplus.questions`.
- A phase strip, Continue, or a phase-approval button.
- A second prompt, a scripted question, avatars, or `Response required`.
- Resetting `bolt-walkthrough`, or editing Electron, Gas City, Bolt, or Forma.
- Seeding users, changing production Clerk, or adding the lab host to Clerk origins.
- Implementing the harness image inside this repository.
