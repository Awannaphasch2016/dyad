# Superpowers drives the Dyad UI for the GIT site

One real run. Superpowers is the methodology. The composer we just shipped is where a person answers. Spec Kit is not selected for this run.

## What already exists

| Piece               | Where                                                                | What it does today                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer answer box | `src/components/chat/ChatInput.tsx`, `FactoryComposerQuestion.tsx`   | An open factory question is typed in the composer. The matching role gets the field. The other role sees the waiting line. The free prompt stays locked until that question is submitted. |
| Phase bar           | `src/components/chat/FactoryPhaseBar.tsx`                            | Switches Discovery, Implementation, and Delivery. Approve and Send back stay here. It does not collect the answer.                                                                        |
| Phase start         | `factoryPhaseKickoff` in `src/lib/factoryPhase.ts`                   | A phase starts itself. Nobody presses Send.                                                                                                                                               |
| Role on the formula | `formulas/superpowers-hitl/formulas/superpowers-phased.formula.toml` | Discovery and Delivery accept only `project-manager`. Implementation accepts only `developer`. The check is `human-gate-verdict.sh`.                                                      |
| Factory agent       | `src/prompts/factory_phase_prompt.ts`                                | Still a one-page website script. It does not sling `superpowers-phased`.                                                                                                                  |

`formulas/README.md` says Dyad writes `human_gate.verdict` and `human_gate.role` from the signed-in membership. No code in `src/` does that write.

## What this run is

The Project Manager and the Developer use one Dyad app. The methodology on that app is Superpowers. Gas City runs `superpowers-phased` against the GIT 2025 conference site. Each phase gate shows up in the composer for the role that gate names. Approve and Send back write the verdict Gas City already checks.

The recorded scripted walkthrough (`DYAD_FACTORY_SCRIPT=record`, Actions run 38556844109) proved the composer. It is not this run. It never called Superpowers. Playwright drove that walkthrough with replies chosen before the run. That is the wrong driver here.

## Methodology choice

The app stores one methodology id. For this run the id is `superpowers`.

That id selects `superpowers-phased`. It does not select `speckit-phased`, and it does not select the one-page prompt in `factory_phase_prompt.ts`.

Other packs stay unlaunched. OpenSpec, Spec Kit, BMAD, gstack, and Compound Engineering are not choices on this app.

## How Superpowers drives the screen

1. Creating the app with methodology `superpowers` starts one Gas City bead on `superpowers-phased`. The worker repo is the GIT baseline below. Dyad does not send "Start Discovery." as the agent prompt.
2. When the formula reaches `accept-discovery`, `accept-implementation`, or `accept-delivery`, Dyad opens one question for that bead.
   - Body is `gc.human_gate.question`.
   - Role is `gc.human_gate.role`.
   - Phase tab is `gc.human_gate.phase`.
3. The composer already renders that question. The target role gets the field. The other role gets the waiting line and cannot type.
4. Approve on the phase bar writes `human_gate.verdict=approve` and `human_gate.role` from the signed-in Clerk membership. Send back writes `request-changes` plus the feedback, from that same membership. A role that does not match the gate cannot write an accepting verdict.
5. Submitting the composer field while a gate is open is Send back: the text is `human_gate.feedback`. It does not start a new chat instruction.
6. The formula's revision child runs on `request-changes`. The same gate opens again. The phase does not advance.
7. A phase still opens by itself when the formula enters it. Nobody presses Send to begin Discovery, Implementation, or Delivery.
8. Inner Superpowers design and spec approval stay autonomous (`brainstorming_approval_mode=autonomous`). Those loops are not extra Dyad gates. The three phase gates are the stops a person sees.

## Who unblocks a gate

The reply is not known when the run starts. [PR #127](https://github.com/Awannaphasch2016/dyad/pull/127) states the rule: a browser script may open the browsers and record them, and it cannot decide the reply. The scripted factory walkthrough breaks that rule. `scriptedAgentText` already contains both sentences.

The walkthrough that already follows the rule is the `hitl` job in `.github/workflows/preview-vibesdk.yml` on [PR #128](https://github.com/Awannaphasch2016/dyad/pull/128). Playwright holds the two Clerk sessions and types. The sentence comes from a live model call (`answerQuestion` in `e2e-vibesdk/tests/two-roles.spec.js`) after the question appears on screen. On that run the builder asked “What type of neighborhood shop is this?” and the reply was generated from that text.

That job is the automation to keep. It is not yet a tool. The next section says what to lift out of it, and what not to rebuild.

## GIT project

Start the worker from the baseline, not from a finished Spec Kit tree.

| Item                  | Value                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec                  | GIT 2025 Conference Website, Public Pages. Version `gitcon-v1`. SHA-256 `30916614bd4380d1a93c92432e9753f3038ecfacd6e976906332ad4086485127`.                                                                          |
| Spec location         | `experiments/sdd/specs/gitcon/v1/requirements.md` on the Spec Kit experiment (plan PR #94, harness PR #99). English only. Home, Program, Registration Fee, Contact. PHP 8.2+, one Dockerfile, no network at runtime. |
| Worker repo           | `https://github.com/Awannaphasch2016/sdd-gitcon-impl`                                                                                                                                                                |
| Start tag             | `baseline/speckit-1.1.2` at `a41476e8d1`                                                                                                                                                                             |
| Formula vars          | `artifact_root=specs/gitcon-v1`, `drain_policy=same-session`, `brainstorming_approval_mode=autonomous`                                                                                                               |
| Launch                | `gc sling gc.run-operator <bead-id> --on superpowers-phased` with those vars                                                                                                                                         |
| Ground truth withheld | `Wewebplus/dev25-git-con` and the live conference site                                                                                                                                                               |

Spec Kit run 1 scored 16/20. Spec Kit run 2 scored 20/20. Those scores are the comparison, not the starting tree.

## Where it runs

One organization, Wewebplus. Two signed-in roles on one Dyad process and one SQLite file. Two browsers attach through the browser bridge. Neon is not the question store.

Gas City runs in one container that has `gc` and the upstream `superpowers-build` pack, because `superpowers-phased` extends it. This cloud agent VM has neither Docker nor `gc`. The sling happens on that host. Dyad on the bridge is the UI.

The Cursor key stays in the Dyad process. It is not placed in the child agent environment.

The scripted walkthrough step stays at 5 minutes. It is not reused for this run. Do not raise that timeout. The reusable walkthrough below is a separate workflow. It waits on each live gate for as long as the app takes, and it uploads both videos, the screenshots, and the run log.

## Decisions

- Superpowers is the only methodology on this app.
- The composer is the question box. The phase bar does not grow an answer field again.
- The three formula gates are the phase approvals. Question text comes from the formula, not from a fixed sentence in the test.
- Zero free-text questions inside a phase is a valid finish. The gate is still required.
- Implementation is accepted by the Developer. Discovery and Delivery are accepted by the Project Manager.
- The worker starts at `baseline/speckit-1.1.2` plus `requirements.md`.
- The reusable walkthrough is the `hitl` job from PR #128, made config-driven. A Cursor Cloud Agent decides each reply. The job holds the browsers and the Clerk tickets.

## Dependencies

- Composer UI on `cursor/composer-bar-factory-9b9b` (PR #160).
- Role check on `cursor/human-role-gate-9b9b` (PR #155).
- `superpowers-phased` from the methodology packs (PR #154).
- A Gas City host with `gc`, `gascity`, and upstream `superpowers-build`.
- The GIT baseline repo and the `gitcon-v1` requirements file.
- Two Clerk org memberships whose `publicMetadata.role` is `project-manager` and `developer`. `org:admin` is not a gate role.
- The `hitl` job and `e2e-vibesdk/tests/two-roles.spec.js` from PR #128, and the Cursor client in `hitl-cursor-probe.yml`.
- The existing GIT acceptance verifier, run against the Superpowers head.

## Risks

- Prompting the one-page factory and calling it Superpowers. The bead's formula must be `superpowers-phased`.
- Starting from the Spec Kit 20/20 tree. That hides whether Superpowers can build the site.
- Showing the live conference site to the worker.
- Writing a verdict without `human_gate.role`, or copying the role from the button instead of the signed-in membership.
- Treating a green factory unit test, or the scripted walkthrough, as this run.
- Letting a prepared sentence, including `scriptedAgentText`, count as a gate answer.
- Putting `CLERK_SECRET_KEY` or a sign-in ticket into the Cursor Cloud Agent. The ticket lasts 300 seconds and the job is the only place that may create and spend it.
- Launching any other methodology pack in the same pass.

## Acceptance

The run is done when all of these are true:

1. The app's methodology is `superpowers`, and the Gas City bead was slung on `superpowers-phased`.
2. The worker commit started from `baseline/speckit-1.1.2`, with `requirements.md` added and the live site withheld.
3. The reusable walkthrough ran with the Dyad config. Discovery's gate was answered only from the Project Manager session. Implementation's gate was answered only from the Developer session. Delivery's gate was answered only from the Project Manager session. Each reply text came back from a Cursor Cloud Agent that was given that question, not from a sentence stored in the test.
4. Each accepted gate has `human_gate.verdict=approve` and `human_gate.role` equal to that gate's `gc.human_gate.role`.
5. All three phases reached approved. Download or publish happened only after Delivery was approved.
6. The GIT acceptance verifier ran on the Superpowers head, and the report is saved with the Gas City run id, bead ids, and both recordings.

A passing unit test does not close this. The scripted composer walkthrough does not close this.

## Reusable UI walkthrough

The capability already exists as one job and one spec. It is pinned to Vibe SDK. This run generalizes that job. It does not add a second browser system, and it does not point future apps back at PR #128.

### What exists

| Piece                                        | Where                                                            | Reuse                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two browsers, two roles, videos, screenshots | `e2e-vibesdk/tests/two-roles.spec.js` on PR #128                 | The loop: sign in, start, poll, show the question to one role, hide it from the other, type the reply, upload evidence                                    |
| The job that runs that loop                  | `hitl` in `.github/workflows/preview-vibesdk.yml`                | Doppler OIDC, Clerk lookup, Playwright install, `upload-artifact`                                                                                         |
| Sign-in ticket                               | `createSignInToken`, 300 seconds, also in `e2e-bridge/signin.ts` | Same Clerk call. The job creates the ticket and spends it                                                                                                 |
| Launch a Cursor Cloud Agent from Actions     | `.github/workflows/hitl-cursor-probe.yml`                        | `POST /v1/agents`, poll `GET /v1/agents/{id}/runs/{runId}`, delete the agent. The key stays in the job. The probe's prompt is `pong`. It never opens a UI |
| Scripted Dyad walkthrough                    | `.github/workflows/dyad-bridge-signin.yml`                       | Do not reuse for a live gate. `DYAD_FACTORY_SCRIPT=record` types sentences that were written before the run                                               |

`answerQuestion` in the Vibe SDK spec calls OpenRouter (`anthropic/claude-sonnet-4.5`) with the question text. That is the decider. It is not a Cursor Cloud Agent. No workflow in this repo launches a Cursor Cloud Agent that signs in and clicks.

### What a Cursor Cloud Agent can do from Actions

The probe already launches one. The agent runs in Cursor's cloud on a repository prompt. It can return a reply. It does not receive the runner's browser, and it must not receive `CLERK_SECRET_KEY`. A ticket spent inside the agent expires in 300 seconds and leaves the job unable to prove which role clicked.

So the split stays the one PR #128 already runs:

- The GitHub Actions job signs in, watches both roles, types, clicks Approve or Send back, and records video.
- The Cursor Cloud Agent is called once per open question, with the question text, the role, and a screenshot. It returns the reply or the verdict (`approve` or `request-changes` plus feedback). The job types that result into the session that owns the role.

That is the smallest change from the working job: replace the OpenRouter call with the probe's Cursor client. The agent judges. The job is the hands.

### Engine and config

One workflow, `.github/workflows/ui-walk.yml`, taken from the `hitl` job with the branch pin removed (`github.event.pull_request.head.ref == 'cursor/vibesdk-org-prompt-hitl-0539'`). `workflow_dispatch` takes a config path. One runner, `e2e-walk/walk.mjs`, taken from `two-roles.spec.js`. The spec's Vibe SDK selectors move into a config file. The runner reads the config. It does not mention an app by name.

A config names:

| Field        | Vibe SDK today                                                                                          | Dyad for this run                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `url`        | `VIBESDK_URL`                                                                                           | The bridge URL                                                            |
| `roles`      | Project Manager and Developer user ids from `scripts/doppler/vibesdk-hitl-accounts.mjs`                 | The same two Wewebplus memberships                                        |
| `start`      | Project Manager types "Build a website for a neighborhood shop." Developer Enter must not create an app | No first prompt. Discovery starts itself                                  |
| `question`   | `org-question`                                                                                          | The question body inside `chat-input-container`                           |
| `waiting`    | `org-waiting`                                                                                           | `hitl-wait-*`                                                             |
| `reply`      | Last `textarea`, then Enter                                                                             | The composer field, then "Submit answer"                                  |
| `approve`    | None                                                                                                    | Phase bar Approve                                                         |
| `sendBack`   | None                                                                                                    | Phase bar Send back                                                       |
| `completion` | At least one answer, then three quiet minutes                                                           | Delivery approved, then download visible to both                          |
| `decider`    | OpenRouter, one short sentence                                                                          | Cursor Cloud Agent. Approve only when the signed-in role matches the gate |

Switching builder or methodology is a second config file. The workflow, the Clerk ticket, the poll loop, the Cursor client, and the artifact upload stay. Bolt and a later pack get a config, not a copy of the spec.

### Evidence

The job uploads the same set the Vibe SDK job uploads: both videos, screenshots of the question, the waiting line, and the reply, plus a log of role, question id, agent id, and verdict. The log does not contain the Clerk ticket, the Cursor key, or the reply text when that text would echo a secret. Videos are encoded H.264 when they are handed to a phone. The Actions artifact can stay WebM.

### Gaps, in order

1. Move the loop and the job off the Vibe SDK branch into `ui-walk.yml` and `e2e-walk/walk.mjs`. Keep a `vibesdk.json` config so the old run still has a home.
2. Replace `answerQuestion`'s OpenRouter call with the Cursor client from `hitl-cursor-probe.yml`. One agent per question, plan mode, no pull request, then delete the agent.
3. Add approve and send-back to the runner. The Vibe SDK spec only presses Enter in a textarea.
4. Add `dyad.json` for the composer test ids. That config is what the Superpowers GIT run invokes.
5. Leave `dyad-bridge-signin.yml` and its five-minute scripted step alone.

## Out of scope

Other methodology packs as runs. A second organization. Neon as the question store. Editing the scripted Northwind prompts so they mention Superpowers. Raising the 5-minute scripted recording timeout. Giving the worker the live conference site. A new browser runner that does not start from `e2e-vibesdk/tests/two-roles.spec.js`.
