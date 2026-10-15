# Attach the host SSM profile with ops-axi

Status: plan only. Not started. Do not cherry-pick PR #177. Do not sling. Do not copy `preview-formula-role.yml`. The shared transport is [plans/ops-axi-horizontal-layers.md](plans/ops-axi-horizontal-layers.md). This command is a caller of `host-exec`, and that composite is extracted before this command is added.

Yes. ops-axi can do the console step. `ops-axi formula role` already SSHes to `ubuntu@13.251.216.187` and the host's `aws` / `dev` keys already call IAM from `scripts/gascity/setup_formula_role.py`. The prepare command uses that path once. It does not open the AWS console, and it does not put an AWS key on the cloud agent.

## Commands

Three names. The agent does not send a shell string.

| Command | Path | What it changes |
| --- | --- | --- |
| `ops-axi session prepare` | SSH, same as `preview-formula-role.yml` | Adds `AmazonSSMManagedInstanceCore` on the host. Creates `gascity-agent-exec` for later SSM calls. |
| `ops-axi session status` | SSM `DescribeInstanceInformation` | Nothing. Prints `ping=`. |
| `ops-axi session run echo-ok` | SSM `SendCommand` of `echo ok` | Nothing on the host except that print. |

`session status` and `session run echo-ok` do not SSH. They assume `gascity-agent-exec`. That role does not exist until `prepare` succeeds.

Doppler defaults match the host commands already in the catalog: `--project dyad --config prd` and `--aws-project aws --aws-config dev`. The job prints `project=` and `config=` before it reads anything. A missing flag uses that default. The command does not accept a free-form script.

## What prepare does

Workflow `session-prepare.yml` on `cursor/ops-axi-commands-f1a5`. Push to that branch runs it, because a dispatch from this agent fails until the file is on the default branch. A refused dispatch still fails the command and does not rerun an older run.

The job checks out, logs in to Doppler with `DOPPLER_SERVICE_IDENTITY_ID`, fetches `EC2_SSH_KEY` the same way `preview-formula-role.yml` does, and SSHes one script: `scripts/gascity/setup_host_ssm.py`. The script runs on the host. It reads `/etc/doppler/aws-dev.token` when the workflow did not forward a token. It prints names and statuses. It does not print keys, tokens, or role ARNs.

On the instance whose public address is `13.251.216.187`:

1. Resolve the instance id. Print `instance=`.
2. If the instance has no instance profile, create role `gascity-host-ssm` trusted by `ec2.amazonaws.com`, attach the AWS managed policy `AmazonSSMManagedInstanceCore`, create an instance profile of the same name, and associate it. Print `profile=created`.
3. If a profile is already attached, keep it. Do not call `ReplaceIamInstanceProfileAssociation`. Read its role. If `AmazonSSMManagedInstanceCore` is already attached, print `ssm_policy=present`. If it is not, attach that one managed policy to the existing role and print `ssm_policy=attached`. Detach nothing.
4. Create role `gascity-agent-exec` if it is absent. Trust is GitHub OIDC for `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/ops-axi-commands-f1a5`. Permissions are `ssm:SendCommand`, `ssm:GetCommandInvocation`, `ssm:DescribeInstanceInformation`, and `ec2:DescribeInstances`, limited to this instance and the document `AWS-RunShellScript`. No ECS actions. No `ssm:StartSession`.
5. Poll until `ping=Online` or the timeout. Print `ping=`.

If AWS returns `AccessDenied`, print `aws=denied action=<action>` and exit 1. Do not retry with a wider policy and do not fall back to a pasted key.

## Catalog

Add the three operations to `packages/ops-axi/lib/catalog.js` on `cursor/ops-axi-commands-f1a5`. `defaultRef` is that branch. `session prepare` is `writes: true`. The other two are read-only. Tests use the fake `gh` already in `packages/ops-axi/test`: prepare sends the workflow and does not send a shell; echo-ok's workflow contains `echo ok` and does not contain `StartSession`; a refused dispatch does not rerun.

`setup_host_ssm.py` tests cover the three instance cases with a fake AWS client: no profile, existing profile without the managed policy, existing profile that already has it. The replace API is not called in any case.

## Done when

A push of `session-prepare.yml` prints `ssm_policy=present` or `ssm_policy=attached` or `profile=created`, then `ping=Online`. The following push of the status workflow prints `ping=Online` and `output=ok`. The role policy printed for `gascity-agent-exec` has no ECS action. The cloud agent environment still has no AWS key.

Then the cherry-pick on PR #177 can start. It does not start in the same change as this workflow.

## Out of scope

- The AWS console.
- Replacing SSH on `gascity-rollout.yml`.
- Enabling ECS Exec or `ecs:RunTask`.
- Creating `Awannaphasch2016/ops-axi`.
- Slinging a formula.
