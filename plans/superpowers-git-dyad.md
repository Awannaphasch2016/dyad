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

The recorded scripted walkthrough (`DYAD_FACTORY_SCRIPT=record`, Actions run 38556844109) proved the composer. It is not this run. It never called Superpowers.

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

The scripted walkthrough step stays at 5 minutes. A live Superpowers run is longer than that step. Record the two browsers on a path that can wait at each gate. Do not raise the scripted workflow timeout to cover this run.

## Decisions

- Superpowers is the only methodology on this app.
- The composer is the question box. The phase bar does not grow an answer field again.
- The three formula gates are the phase approvals. Question text comes from the formula, not from a fixed sentence in the test.
- Zero free-text questions inside a phase is a valid finish. The gate is still required.
- Implementation is accepted by the Developer. Discovery and Delivery are accepted by the Project Manager.
- The worker starts at `baseline/speckit-1.1.2` plus `requirements.md`.

## Dependencies

- Composer UI on `cursor/composer-bar-factory-9b9b` (PR #160).
- Role check on `cursor/human-role-gate-9b9b` (PR #155).
- `superpowers-phased` from the methodology packs (PR #154).
- A Gas City host with `gc`, `gascity`, and upstream `superpowers-build`.
- The GIT baseline repo and the `gitcon-v1` requirements file.
- Two Clerk org memberships whose `publicMetadata.role` is `project-manager` and `developer`. `org:admin` is not a gate role.
- The existing GIT acceptance verifier, run against the Superpowers head.

## Risks

- Prompting the one-page factory and calling it Superpowers. The bead's formula must be `superpowers-phased`.
- Starting from the Spec Kit 20/20 tree. That hides whether Superpowers can build the site.
- Showing the live conference site to the worker.
- Writing a verdict without `human_gate.role`, or copying the role from the button instead of the signed-in membership.
- Treating a green factory unit test, or the scripted walkthrough, as this run.
- Launching any other methodology pack in the same pass.

## Acceptance

The run is done when all of these are true:

1. The app's methodology is `superpowers`, and the Gas City bead was slung on `superpowers-phased`.
2. The worker commit started from `baseline/speckit-1.1.2`, with `requirements.md` added and the live site withheld.
3. Both browsers recorded the same app. Discovery's gate was answerable only by the Project Manager, in the composer. Implementation's gate was answerable only by the Developer. Delivery's gate was answerable only by the Project Manager.
4. Each accepted gate has `human_gate.verdict=approve` and `human_gate.role` equal to that gate's `gc.human_gate.role`.
5. All three phases reached approved. Download or publish happened only after Delivery was approved.
6. The GIT acceptance verifier ran on the Superpowers head, and the report is saved with the Gas City run id, bead ids, and both recordings.

A passing unit test does not close this. The scripted composer walkthrough does not close this.

## Out of scope

Other methodology packs. A second organization. Neon as the question store. Editing the scripted Northwind prompts so they mention Superpowers. Raising the 5-minute scripted recording timeout. Giving the worker the live conference site.
