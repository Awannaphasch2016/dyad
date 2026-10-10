# Short-lived Doppler credentials for host operations

> Written 2026-10-10. Replaces the two expired token files on the EC2 host with the short-lived token GitHub Actions already mints. No new credential is created and nothing long-lived is stored on the host.

## Problem

GitHub Actions can reach the EC2 host, but the script it launches there cannot authenticate to Doppler, so no rollout can be built and the formula IAM role cannot be created.

The containers are not affected. They never contact Doppler: `scripts/gascity/host-wrapper.sh` downloads secrets once, at rollout time, into an env file, and compose starts the container with it. A restart keeps that env. The live backend still has its secrets.

What is dead is two root-owned files, both measured at HTTP 401 on 2026-10-09 by [run 37978419841](https://github.com/Awannaphasch2016/dyad/actions/runs/37978419841):

| File                              | Used by                                      | For                                                                                        |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/etc/doppler/dyad-preview.token` | the rollout wrapper, `setup_formula_role.py` | reading `dyad`/`preview`; the role script also writes `AWS_PREVIEW_FORMULA_ROLE_ARN` there |
| `/etc/doppler/aws-dev.token`      | the rollout wrapper, `setup_formula_role.py` | reading `aws`/`dev` (the static AWS keys)                                                  |

Both callers are launched over SSH by a workflow: `gascity-rollout.yml` and `preview-formula-role.yml`. The last rollout to fail this way was [run 37073686042](https://github.com/Awannaphasch2016/dyad/actions/runs/37073686042) on 2026-10-02. Nothing on the host fetches secrets on its own, so a credential that lives only for one SSH session covers every failure that exists today.

## Why the existing identity is sufficient

The Doppler Service Account Identity already exchanges the job's GitHub OIDC token for a Doppler token that lasts about an hour ([run 37978419946](https://github.com/Awannaphasch2016/dyad/actions/runs/37978419946), `doppler_oidc=http-200`). It authenticates the job, not the host, because a process on EC2 has no GitHub OIDC token. The job can hand its token across the SSH session it already opens. The token expires on its own, the runner is destroyed after the job, and the host writes nothing to disk.

Measured scope of that identity: it can read `dyad`/`preview` and it cannot read `dyad`/`dev`. Access to `aws`/`dev` and write access to `dyad`/`preview` are untested. Both are required and are the one manual step below.

## The change

One token instead of two files. The workflow mints it with `.github/actions/doppler-oidc`, which masks it, and passes it to the remote command as `DOPPLER_TOKEN`. The host script uses that value for both downloads, naming the project and config explicitly, and falls back to the files when the variable is unset. Passing the token rather than the secrets means secret values never sit on the runner.

```
job --OIDC--> Doppler --short-lived token--> job
job --SSH, DOPPLER_TOKEN set for the command--> host script
host script --that token--> Doppler (dyad/preview and aws/dev)
host script --> env file --> container        (unchanged)
```

### Pieces

| #   | Piece                                            | Where                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Service account access                           | Doppler dashboard                                                                | Read on `aws`/`dev`, write on `dyad`/`preview`, and a `sub` claim for `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/browser-dyad-ui-bbea`. The claims for `cursor/axi-toolbox-image-plan-531e` and `cursor/formula-config-ui-55d6` already work                                                                                                                                                                                             |
| 2   | Wrapper takes the token from the environment     | `scripts/gascity/host-wrapper.sh`                                                | `DOPPLER_TOKEN` set: use it for both downloads and do not read the files. Unset: current behavior. The token is unset before Dagger runs, as today. A test in `scripts/gascity/rollout.test.sh` runs the wrapper with a fake `doppler` on `PATH` and checks it never prints the token                                                                                                                                                           |
| 3   | Rollout passes the token                         | `.github/workflows/gascity-rollout.yml`                                          | `id-token: write`, the OIDC action, and the token in the SSH command's environment. The workflow pipes the wrapper over SSH (`sudo bash -s`) instead of calling `/usr/local/sbin/gascity-rollout`, so the outer phase is the version from the commit being rolled out; that phase fast-forwards the checkout and re-execs the copy that now contains piece 2. This is what lets the first rollout work while the host still has the old wrapper |
| 4   | Role script takes the token from the environment | `scripts/gascity/setup_formula_role.py`                                          | The workflow already mints a token and already pipes this script over SSH. The script uses `DOPPLER_TOKEN` for both the `dyad` write and the `aws` read, and reads the files only when it is unset                                                                                                                                                                                                                                              |
| 5   | The check reports the new path                   | `scripts/gascity/check_host_access.py`, `.github/workflows/ec2-access-check.yml` | Forward the minted token and print `forwarded_token=http-200 project=dyad config=preview` plus whether `aws`/`dev` is readable. File lines stay, so `dyad_token=missing` becomes the success state once the files are gone                                                                                                                                                                                                                      |
| 6   | Delete the files                                 | on the host, last                                                                | Only after a rollout and a role run have succeeded on the forwarded token. `ops-axi ec2 check` then shows the files absent and the forwarded token working                                                                                                                                                                                                                                                                                      |

Pieces 2 and 3 land on `cursor/browser-dyad-ui-bbea`, because that is the branch the host checks out and the only branch `gascity-rollout.yml` runs on. Pieces 4 and 5 land on `cursor/formula-config-ui-55d6` through PR #92.

## What you do

1. In Doppler, on the service account behind the identity: grant read on project `aws` config `dev` and write on project `dyad` config `preview`. Add the `sub` claim for `cursor/browser-dyad-ui-bbea`.
2. Nothing else. The workflows, the wrapper, and the check are the implementation work, and the files are deleted only after the proof runs.

## What you can check

- `ops-axi ec2 check` prints `forwarded_token=http-200` and `aws_token_via_forwarded=http-200` before any file is removed.
- `ops-axi rollout <sha>` completes for the commit that contains piece 2, with no token file read (the wrapper prints `doppler_source=env`).
- `ops-axi formula role` prints `AWS_PREVIEW_FORMULA_ROLE_ARN=stored` and `doppler_source=env`.
- After the files are removed, `ops-axi ec2 check` prints `dyad_token=missing`, `aws_token=missing`, and `forwarded_token=http-200`.
- No run log contains a token or a secret value. The OIDC action masks the token, and the scripts print only `http-NNN`, project, and config.

## Out of scope

- An EC2 instance role that authenticates to Doppler directly through AWS IAM outbound identity federation ([Doppler's guide](https://docs.doppler.com/docs/aws-ec2-oidc)). That removes the dependency on a workflow for host-initiated fetches, and the same role would replace the static AWS keys in `aws`/`dev`. Nothing on the host fetches secrets on its own today, so this solves a case that does not exist yet.
- Replacing those static AWS keys.
- The Doppler project reorganization in `plans/doppler-organization.md`.
- Restoring the Doppler → GitHub sync. It delivers secrets to GitHub, not to the host, and the SSH key already arrives by OIDC.
