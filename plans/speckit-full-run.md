# One full Spec Kit run on the Gas City formula

## Reference

This run uses the Spec Kit formulas already written, and it does not add another methodology.

| What | Where |
| --- | --- |
| Gas City formula packs | [PR #148](https://github.com/Awannaphasch2016/dyad/pull/148), branch `cursor/openspec-speckit-formulas-d072`. Adds `formulas/openspec`, `formulas/speckit`, and `formulas/gsd`, each extending `build-base`. |
| Phased Spec Kit graph | [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154), branch `cursor/methodology-packs-col2-col3-d072`. `speckit-build` is the command sequence. `speckit-phased` keeps that sequence and adds the Discovery, Implementation, and Delivery gates. |
| Frozen comparison, not started | [PR #156](https://github.com/Awannaphasch2016/dyad/pull/156), `plans/gitcon-methodology-runs.md`. Three first runs on one specification. No run was started. |

The formula this run slings is `speckit-phased` in `formulas/speckit/formulas/speckit-phased.formula.toml`. `speckit-build` is the same command order without the three gates. The native skill run and the ungated `speckit-build` run stay in PR #156. They are not launched here.

OpenSpec and GSD are in PR #148. They are not this run. The baseline tree already contains Spec Kit skills, which is why PR #156 kept those packs out.

## Important points

- One run: `speckit-phased` from `baseline/speckit-1.1.2` through publish, then the existing acceptance verifier.
- Repository `Awannaphasch2016/sdd-gitcon-impl`. Tag `baseline/speckit-1.1.2` is commit `a41476e8d1330c90e49eb2dacf8b729ebb3a16f5`.
- Specification `gitcon-v1`, sha256 `30916614bd4380d1a93c92432e9753f3038ecfacd6e976906332ad4086485127`, saved as `SPEC.md` and left byte-identical.
- Score is AC-01 through AC-20, the specification hash, and the leak scan. A finished formula with no verifier artifact has no score.
- The executor is `gc sling`, not `experiments/sdd/bin/start-worker.mjs`. That script posts a Cursor agent that runs the skills in one prompt.
- Human gates mail the `human` mailbox and do not name a project manager or a developer. The closer writes `human_gate.verdict` from artifact presence.
- The Dockerfile rewrite at `1b0784ea` and the earlier site at `bc32948` are not inputs.
- This document does not start the run.

## Summary

Run Spec Kit once, as the Gas City formula `speckit-phased`, on the clean GIT Conference baseline. The city walks specify, clarify, plan, tasks, the Discovery gate, the implement drain, converge, the Implementation gate, the final report, the Delivery gate, and publish. The harness verifier then scores the commit that publish pushed. A second iteration is not written from this plan.

## Problem Statement

PR #148 and PR #154 define the formula. PR #156 defines the shared input and the three-way comparison, and it leaves the Gas City rig unstarted. A formula that has never been slung against the acceptance suite is not yet a measured spec-driven run. This plan is that one full execution.

## Scope

### In Scope

- One sling of `speckit-phased` on a rig whose worktree starts at `a41476e8d1330c90e49eb2dacf8b729ebb3a16f5`.
- `SPEC.md` at the repository root, byte-identical to `experiments/sdd/specs/gitcon/v1/requirements.md` on `cursor/sdd-experiment-harness-be23`.
- `artifact_root` set to the directory where the formula writes `spec.md`, `plan.md`, and `tasks.md`. The formula does not rewrite `SPEC.md`.
- A gate closer for the three confirmation beads. It approves only when the artifacts that gate is waiting on are present.
- Push of branch `exp/2026-10-14-gitcon-v1-speckit-phased-01`. The verifier uses that head.
- One `run.json` on `cursor/sdd-experiment-harness-be23`, which is the only branch `.github/workflows/sdd-verify.yml` listens to.
- Run id `2026-10-14-gitcon-v1-speckit-phased-01`.

### Out of Scope

- `speckit-build` and the native `/speckit-*` skill worker. Those are the other two cells in PR #156.
- OpenSpec, GSD, BMAD, Superpowers, gstack, Compound Engineering, and `build-basic`.
- Any second-iteration prompt, including the contact-form Dockerfile change from `2026-10-10-gitcon-v1-speckit-02`.
- Starting at `bc32948` or `1b0784ea`.
- Merging the implementation branch, or handing the worker `dev25-git-con` or `https://gitconference.git.or.th`.
- Dyad application code, Vibe SDK, shared `wewebplus`, Bolt, and the factory poller that answers with fixed role strings.
- A registry release of the packs. PR #148 records that pushing `formulas/` to `Awannaphasch2016/gascity-packs` was denied. The city imports the formulas from this Dyad branch.

## The formula, in order

`formulas/speckit/README.md` states the sequence. `speckit-phased` adds the gates. `specify workflow` stays off.

| Step id | What it does | Gate |
| --- | --- | --- |
| `requirements` | Specify. Writes `spec.md`. | |
| `clarify` | At most five questions, and only while `spec.md` contains `NEEDS CLARIFICATION`. | Inside Discovery. |
| `plan` | Plan. | |
| `plan-review` | Records the plan. | |
| `decompose` | Tasks. Writes `tasks.md`. | |
| `accept-discovery` | Mail `human`: "Approve these discovery artifacts and start implementation?" | Discovery closes here, before the implement drain. |
| `implement` | Task drain (`do-work`). Needs `accept-discovery`. | |
| `review` | Converge. | |
| `accept-implementation` | Mail `human`: "Approve this implementation and its review?" | Implementation closes here, before the final report. |
| `finalize` | Writes the final report. Needs `accept-implementation`. | |
| `accept-delivery` | Mail `human`: "Approve delivery and allow publish?" | Delivery closes here, before publish. |
| `publish` | Push or an explicit no-op, recorded on the root bead. Needs `accept-delivery`. | |

`request-changes` on a bead runs that gate's revision child again. This run's closer does not send `request-changes`. A missing artifact leaves the bead open.

## User flow

1. Confirm the tag, the specification hash, and that `gc` can resolve `speckit-phased` with the upstream `build-base` expansions on the formula path.
2. Copy `gitcon-v1` to `SPEC.md` on a new worktree at the baseline commit. The acceptance directory stays in the Dyad harness. The city never receives it.
3. Sling `speckit-phased`. The closer watches the three confirmation beads and writes `human_gate.verdict`.
4. Publish pushes `exp/2026-10-14-gitcon-v1-speckit-phased-01`. If the pull-request integration rejects that branch name, record the pushed sha the way run `2026-10-10-gitcon-v1-speckit-02` did. Do not merge.
5. Commit `experiments/sdd/runs/2026-10-14-gitcon-v1-speckit-phased-01/run.json` on `cursor/sdd-experiment-harness-be23` with `pr.head_sha` set. That push starts `SDD verify`.
6. The report lists AC-01 through AC-20, the head commit, the verifier URL, the specification check, and the leak scan. Empty cells stay empty.

## Gate closer

The formula check is `formulas/speckit/assets/scripts/checks/human-gate-verdict.sh`. It reads `human_gate.verdict` on the confirmation bead. `approve` continues. A missing verdict fails the check and the gate's children run again.

The closer sends no product opinion and does not post a role answer.

| Gate | Approve when |
| --- | --- |
| Discovery | `spec.md`, `plan.md`, and `tasks.md` exist under `artifact_root`, and `spec.md` has no `NEEDS CLARIFICATION` marker. |
| Implementation | The converge step has finished and the site files exist. |
| Delivery | The final report exists. |

Clarify, when the formula asks, is answered from section 5 of `SPEC.md` and from the requirement tables. The answer adds no page, field, or service.

## Run record

`experiments/sdd/schema/run.schema.json` accepts `approach` value `speckit` only. This run keeps that value so the existing verifier can read the file. `approach_version` is `speckit-phased`. `worker.model` is the model the rig reports. `worker.agent_id` stays null when the executor is the city rather than a Cursor agent. `worker.status` uses the existing enum: `RUNNING` while the city is in progress, `FINISHED` after publish, `ERROR` if the city stops short. Caps match the earlier experiment: 90 minutes of wall clock and an estimated USD 25. A gate that is still open at the cap leaves the run unscored. The closer does not extend the cap by inventing a verdict.

The verifier workflow checks out `impl_repo` at `pr.head_sha`, compares `SPEC.md` to `spec_sha256`, runs `docker build -t sdd-site`, and runs the Playwright suite in `experiments/sdd/specs/gitcon/v1/acceptance/`.

## Implementation steps

This plan is the checklist. Execution is a later turn.

### Freeze the input

- [ ] `git ls-remote` on `Awannaphasch2016/sdd-gitcon-impl` still shows `refs/tags/baseline/speckit-1.1.2` at `a41476e8d1330c90e49eb2dacf8b729ebb3a16f5`.
- [ ] `node experiments/sdd/bin/build-spec.mjs --check` on `cursor/sdd-experiment-harness-be23` still hashes `requirements.md` to `30916614bd4380d1a93c92432e9753f3038ecfacd6e976906332ad4086485127`.
- [ ] AC-01 through AC-20 in `acceptance/criteria.md` are unchanged.

### Prepare the city

- [ ] Import `gascity` from `https://github.com/gastownhall/gascity-packs.git//gascity`.
- [ ] Put this branch's `formulas/speckit` on the formula path. Do not wait for a `gascity-packs` release.
- [ ] `gc` resolves `speckit-phased`, including the inherited `build-base` steps. If it does not, stop. Do not simulate the formula with `start-worker.mjs`.

### Launch

- [ ] New worktree of `sdd-gitcon-impl` at `a41476e8d1330c90e49eb2dacf8b729ebb3a16f5`.
- [ ] Write `SPEC.md` from the checked specification. Do not edit it again.
- [ ] Sling `gc.run-operator` on `speckit-phased` with `artifact_root` set.
- [ ] Start the closer. One open confirmation bead, one verdict, then the formula continues.
- [ ] Stop at the cap if publish has not recorded a head. Leave the AC cells empty.

### Score

- [ ] Write `run.json` for `2026-10-14-gitcon-v1-speckit-phased-01` with the pushed sha.
- [ ] Push that file on `cursor/sdd-experiment-harness-be23` and wait for `SDD verify`.
- [ ] Download the evidence artifact and fill the report from that artifact only.
- [ ] A pass is AC-01 through AC-20, a matching specification hash, and a clean leak scan. Anything else is not a pass, and no follow-up prompt is written in this plan.

## Risks

| Risk | What to do |
| --- | --- |
| `gc` cannot resolve `speckit-phased` because the packs were not imported into `gascity-packs` | Stop. The formulas stay on the Dyad branch until an import is allowed. |
| The closer writes a factory-poller answer instead of `human_gate.verdict` | The check script only reads the verdict field. A chat answer does not release the gate. |
| Publish is disabled and no head is pushed | Record `gc.build.publish_status=noop` and leave the run unscored. Do not point the verifier at the baseline. |
| The city rewrites `SPEC.md` | The verifier reports `spec_check=modified`. That run is not a pass. |
| The 90 minute cap expires during a gate wait | The run is unscored. The closer does not approve a missing artifact to beat the clock. |
| This sample is treated as a ranking against the native and `speckit-build` cells | Those cells are still unrun. This result stands alone. |

## Decision log

- The product scope remains `gitcon-v1` from PR #156: four English pages, one contact form, two JSON fixtures, PHP 8.2, one Dockerfile, no runtime network. Accounts, Thai pages, search, galleries, mail, CAPTCHA, and the admin CMS stay out.
- "Full run" means every step of `speckit-phased`, including the three gates and publish, scored by the existing verifier. It does not mean launching all three comparison cells.
- The formula runtime does not check an organization membership. Role names stay out of this run.
- Historical runs `2026-10-09-gitcon-v1-speckit-01` and `2026-10-10-gitcon-v1-speckit-02` stay in the record. They are not the start of this one.
