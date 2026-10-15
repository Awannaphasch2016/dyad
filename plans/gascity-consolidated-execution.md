# GasCity consolidated execution

Status: plan only. The secure session is not built. The PR #155 cherry-pick on PR #177 is not started. No formula is slung. No experiment runs.

Priority is fixed: secure execution, then PR consolidation, then one agent architecture, then configurable methodologies and gates, then an end-to-end Dyad validation, then experiments. An experiment does not start until the session proof and the consolidated baseline are both green.

## Target architecture

GasCity orders the work. `gc sling` is the only executor. Dyad and Vibe SDK are windows onto that run. They are not orchestrators. A guest session is a GasCity session (`gc session list` and its logs), not a Dyad `FactorySession`.

The first GasCity process runs on the Cursor cloud agent, on localhost, beside Dyad. That is the experiment host. Moving that process into ECS is a later use of the same session, not a second design.

```
Cursor cloud agent
  holds no AWS key, no Doppler token, no GitHub App key
  calls ops-axi session <target> <name>
        |
        v
GitHub Actions  --OIDC-->  IAM role gascity-agent-exec
        |
        +-- ssm SendCommand     EC2 Gas City host (first proof)
        +-- ecs ExecuteCommand  formula-preview task (only after the migration)
        +-- ecs RunTask         one-shot GasCity task (only after the migration)

Dyad window  --localhost-->  gc sling <target> <bead> --on <pack>
Vibe window  --same sling--> gc
```

Human gates stay outside the pack. A pack names beads and checks. A gate is a `human_gate.verdict` plus `human_gate.role` on the bead. Discovery and Delivery require `project-manager`. Implementation requires `developer`. Changing the pack does not change the gate, and changing the gate does not change the pack.

`handleLocalAgentStream` is legacy. A factory turn does not fall through to it. If GasCity is down, the turn fails. There is no native fallback.

## 1. Secure remote execution session

The cloud agent does not call AWS. `ops-axi` remains the client: it starts one workflow, waits, and reads `key=value` lines. It holds no credential. A refused dispatch fails. It does not rerun an older run.

The privileged side is one new workflow, `session.yml`, on the ops-axi catalog branch. The job assumes a new role, `gascity-agent-exec`, in `ap-southeast-1`, through GitHub OIDC. Trust is this repository only. The role is not `formula-preview-task`, and it is not the formula preview role that deploys pages. Those roles stay on their current jobs.

Permissions are scoped to the target the command names:

| Target | API | Resource | When |
| --- | --- | --- | --- |
| `host` | `ssm:SendCommand`, `ssm:GetCommandInvocation`, `ec2:DescribeInstances`, `ssm:DescribeInstanceInformation` | The one Gas City EC2 instance that `ec2-access-check.yml` already reaches at `ubuntu@13.251.216.187` | First proof |
| `ecs-exec` | `ecs:ExecuteCommand` | Cluster `wewebplus-formula-preview`, service `formula-preview` | Migration only |
| `ecs-run` | `ecs:RunTask`, `iam:PassRole` for the formula task roles | One task definition family on that cluster | Migration only |

The first slice grants only the `host` actions. ECS permissions are not on the role until the migration slice. The instance id is resolved in the job from that host. It is not typed into the agent command.

The instance profile is attached by ops-axi, not by a console click. `ops-axi session prepare` uses the SSH path that `formula role` already uses, once, and adds `AmazonSSMManagedInstanceCore` to the host. The plan is [plans/ops-axi-session-prepare.md](plans/ops-axi-session-prepare.md). After `ping=Online`, `session status` and `session run echo-ok` use SSM and do not SSH.

Commands are names, not a shell string from the agent:

| Command | What the job runs |
| --- | --- |
| `ops-axi session status` | Ping status of the host's SSM agent. Prints `role=`, `target=host`, `instance=`, `ping=`. Changes nothing. |
| `ops-axi session run echo-ok` | `ssm:SendCommand` with the document argument `echo ok` and nothing else. Prints `status=` and `output=ok`. |

No other command name is accepted. The workflow rejects a missing name before it calls AWS. Output lines whose keys look like tokens, keys, secrets, or passwords are redacted, using the same rule as `packages/ops-axi`.

SSM is not known to be installed on that host. `session status` is the check. If `ping` is not `Online`, the session is not done, and no one switches the host off SSH. `gascity-rollout.yml` keeps using SSH until a later slice replaces that one path. This slice does not remove the SSH key path.

ECS Exec is off for the formula service today. Enabling `enableExecuteCommand` and the task role's `ssmmessages` channel is part of the migration slice, after the Dyad validation below has passed on the cloud agent.

Windmill is not added. No new broker process is added. The workflow is the session.

### Session done when

- A push of `session.yml` prints `ping=Online` and `output=ok`.
- The role's policy in that log lists only the host SSM and describe actions.
- The cloud agent still has no AWS credential in its environment.
- A dispatch that GitHub refuses fails the command and does not rerun an old run.

A cloud agent can dispatch the workflow only after the file is on the default branch. Until then the proof is the push run. Do not treat a refused dispatch as success.

## 2. Consolidate the existing GasCity work

Resume [PR #177](https://github.com/Awannaphasch2016/dyad/pull/177) only after the session proof. The cherry-pick stays queued. Do not start it in the same change as `session.yml`.

Baseline is [PR #155](https://github.com/Awannaphasch2016/dyad/pull/155), branch `cursor/human-role-gate-9b9b`, commit `9d2becf0`. Packs and `human-gate-verdict.sh` stay. A missing role fails the check.

The branch already contains the phase-machine table in `drizzle/0058_lying_veda.sql`. That is the #142 schema. Do not cherry-pick #142 again and do not add a second `0058`.

Window commits, in order, onto that baseline:

| Commit | PR | Keep |
| --- | --- | --- |
| `c3719f252b` | #146 | Host bridge, tool route, event route |
| `9a5f52d4f6` | #169 | One `speckit-phased` sling, step id, phase bar |
| `6b4fd8af71` | #172 | Paint the bead's text on that phase chat |
| `dd9a4e4c5d` | #172 | Format fix those paint files need |
| `bf34bd3461` | #173 | Approve posts a verdict |

Skip #173 plan commits `820fb9c555` and `e5ebd71b01`. On a drizzle conflict, keep `0058_lying_veda.sql` and generate formula columns (`formula`, `current_step_id`) as the next migration with `npm run db:generate`. Add `role` to the verdict POST. #169 posts `verdict` only, and #155's script rejects that.

Leave out of this cherry-pick: the Vibe catalog walker (#165–#170), `experiments/sdd/bin/start-worker.mjs` (#99), the GIT Conference score (#156, #159), Doppler, the preview image, and ECS. The recorded Northwind path (`DYAD_FACTORY_SCRIPT=record`, `## Phase finished`) is not the executor.

### Pull requests

| PR | What it is | In the baseline |
| --- | --- | --- |
| #155 | Spec Kit packs and the role check | Required baseline |
| #142 | Phase-machine schema and `## Phase finished` | Schema is already on #155. Do not take the executor |
| #146 | Host bridge | Cherry-pick `c3719f252b` |
| #169 | Sling and the phase bar | Cherry-pick `9a5f52d4f6` |
| #172 | Paint the running bead's text | Cherry-pick `6b4fd8af71` and `dd9a4e4c5d` |
| #173 | Verdict POST, plus a rejected recording | Cherry-pick `bf34bd3461` only |
| #160 | Composer the walk clicks | Before the sling. Approve still writes Dyad tables |
| #162 | Walk plan only. `ui-walk.yml` is not a file | Before the sling, after the window exists |
| #92 | Operator AXI, SSH and Doppler jobs | Stays. The session is a new command on the catalog branch |
| #178 | ops-axi catalog, Doppler flags, status workflows | Client for the session. Image `ghcr.io/awannaphasch2016/axi-toolbox@sha256:444324acb964125600819dcea0b617dad511d9e6f2d36a694e098cb6bf98e888` |
| #128 | Vibe two-role loop | Same walk shape. Wired after the Dyad validation |
| #165–#170 | Vibe host walks steps in JavaScript | Not the executor. Delete that walker from the execution path when Vibe joins |
| #99, #156, #159 | Cursor-agent Spec Kit run and the GIT Conference score | After a sling exists. Not the launcher |

Plan-only pull requests to close after this plan is accepted, not before: #141, #144, #145, #149–#152, #163, #164, #168, #171, #175, #176, #136, #162.

### Conflicts

- Two files claim migration `0058`. #155 has `0058_lying_veda.sql`. The orchestrator stack has `0058_overrated_jack_power.sql`. Keep the #155 file.
- #169's verdict has no `role`. #155's check requires `human_gate.role`.
- #142 advances a phase when the model prints `## Phase finished`. The sling must be the thing that advances a bead. The table stays.
- Approve on #160 writes `factory_phase_approvals` and `ensureCursorPhase`. The formula check reads the bead. A Dyad row does not satisfy it.
- `handleLocalAgentStream` still runs when the turn is not a factory phase. The consolidated factory path must not call it.
- The preview image does not contain `gc`. `scripts/gascity/preview-up.sh` records an empty city volume. ECS is not the first GasCity host.
- `ops-axi` dispatch works only when the workflow file is on the default branch. Feature-branch files prove themselves on push. A refused dispatch is a failure.
- Catalog `cursor probe` still points at the consolidation branch, whose probe file does not declare the Doppler inputs. Do not fix that by rerunning an old probe. It is outside this session.
- This cloud agent's GitHub token cannot create a repository (`createRepository` 403). The session does not depend on a new `ops-axi` repository. The Doppler service identity in `DOPPLER_SERVICE_IDENTITY_ID` is not a GitHub token and cannot push `Awannaphasch2016/forma`.

### Unfinished, and still unfinished after the cherry-pick

- `session.yml` and role `gascity-agent-exec` do not exist.
- The five commits are not on the #155 branch. `role` is not on the verdict POST.
- OpenCode is not installed. The city at `/tmp/dyad-city` is stopped and was cooked for Claude. `OPENROUTER_API_KEY` is in Doppler `dyad` / `preview` and is not in this process environment. The city reads it from a job that already fetches that config. Nothing is pasted.
- The localhost adapter that turns a Dyad factory turn into `gc sling` is not written.
- `ui-walk.yml`, `e2e-walk/walk.mjs`, and the two configs are not written. Clicks do not yet write the bead.
- `GAS_CITY_ORCHESTRATOR_URL` is absent from the printed Doppler names. The cloud-agent validation uses localhost, so that URL is not required for the first proof.
- `Awannaphasch2016/ops-axi` was not created. The catalog and the image stay in this repository until the account owner creates the repo.

## 3. One agent execution architecture

After the cherry-pick:

- One machine runs Dyad and `gc`. The cloud agent is that machine for the first validation.
- A factory turn calls `gc sling <target> <bead> --on speckit-phased`. It does not call `tool.execute` on `TOOL_DEFINITIONS`, and it does not call `handleLocalAgentStream`.
- The message list paints text only from the bead GasCity is executing.
- Approve writes `human_gate.verdict` and `human_gate.role`. Request-changes stays in the same phase. Delivery finishes when the publish bead closes.
- One operator answers Discovery and Delivery as `project-manager` and Implementation as `developer`.

Vibe SDK uses that same sling after the Dyad validation. Its JavaScript step walker is removed from the execution path. The window stays.

## 4. Methodologies and human gates

Packs already in the tree are Spec Kit (`speckit-phased`) and OpenSpec. BMAD and Superpowers are later packs, added as files, not as new orchestration code.

Switching packs is the `--on` argument and the city import. The sling client does not grow a branch per pack. Gates are not inside the pack. A gate's role and the phases that require it are configuration on the bead (`gc.human_gate.role`) and on the Approve button. Organization-specific routing is a later map from an organization role to those two role strings. The first validation uses the one confirmed operator, not a second Clerk user.

Order inside `speckit-phased`: requirements, clarify, plan, plan-review, decompose, accept-discovery (`project-manager`), implement, review, accept-implementation (`developer`), finalize, accept-delivery (`project-manager`), publish.

The model path for the first validation is OpenCode with `OPENROUTER_API_KEY` from Doppler `dyad` / `preview`. The key stays in Doppler. Cursor `POST /v1/agents` is not this launcher.

## 5. Validate, then experiment

Validation is one Dyad run on the cloud agent:

1. Session proof is already green.
2. Cherry-pick is on the branch, `npm run fmt`, `npm run lint`, and `npm run ts` pass, and `src/lib/methodologyPacks.test.ts` passes.
3. `gc formula show speckit-phased` lists the beads, and the Discovery gate bead shows `gc.human_gate.role = project-manager`.
4. The city is restarted on OpenCode and OpenRouter. The old city workflow `gc-l6u` is discarded.
5. Dyad sends one factory turn. `gc session logs` shows the bead. The Dyad message list shows that bead's text. The phase bar shows the same step.
6. The operator approves Discovery, Implementation, and Delivery with the roles above. Each approval is visible on the bead as `human_gate.verdict` and `human_gate.role`. A `factory_phase_approvals` row alone does not count.
7. The publish bead closes.

Then Vibe SDK is pointed at the same sling and the same pack. The walk runner records that window. The Northwind recorder stays out of the runner.

Experiments start only after both windows have completed that path. Each variation is one pack or one model setting, scored on quality, execution time, token usage, human-input requests, retries, and the recorded walk. #156, #159, and the verifier half of #99 wait until then. They supply the Spec Kit spec and acceptance checks. They do not supply the launcher.

## Implementation order

1. Add `ops-axi session status` and `ops-axi session run echo-ok` on `cursor/ops-axi-commands-f1a5`. Add `session.yml` and the `gascity-agent-exec` role with host SSM permissions only. Prove `ping=Online` and `output=ok` on a push.
2. Cherry-pick the five commits onto PR #177. Add `role` to the verdict. Generate the formula migration. Format, lint, and type-check.
3. Install OpenCode, point the city at OpenRouter through the existing Doppler fetch, and sling `speckit-phased` from a Dyad factory turn. Wire Approve to the bead.
4. Confirm the three gates with the one operator. Confirm the message list and the phase bar against `gc session logs`.
5. Point Vibe at the same sling. Remove the JavaScript walker from that path. Record the walk.
6. Enable ECS Exec and RunTask on `gascity-agent-exec` only when moving the GasCity process off the cloud agent. Until that move, GasCity stays on the agent.
7. Run methodology variations. Not before step 4 is green, and not before step 5 if the variation includes Vibe.

## Acceptance

| Stage | Green when |
| --- | --- |
| Session | Push log shows `ping=Online` and `output=ok`. Role policy has no ECS actions. Agent environment has no AWS key. |
| Consolidation | One branch has the #155 packs, the five window commits, one migration journal, and a verdict POST that includes `role`. |
| Architecture | A factory turn slings. It does not call `handleLocalAgentStream`. The painted text is the bead's text. |
| Gates | Discovery and Delivery store `project-manager`. Implementation stores `developer`. Request-changes does not leave the phase. |
| Dyad validation | Session logs, the message list, and the phase bar name the same bead through publish. |
| Vibe | The same pack and the same sling, with the JavaScript walker gone from the path. |
| Experiments | Not started. |

## Out of scope for the session slice

- Creating `Awannaphasch2016/ops-axi`.
- Pushing `Awannaphasch2016/forma`.
- Pasting `OPENROUTER_API_KEY` or any Doppler value into the cloud agent.
- Replacing SSH on `gascity-rollout.yml`.
- Enabling ECS Exec.
- Slinging a formula.
- Editing formula TOML except where the cherry-pick already contains it.
- Closing the plan-only pull requests. That happens after this plan is accepted.
