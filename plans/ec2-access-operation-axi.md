# EC2 access, operation AXI, and the formula role ARN

> Written 2026-10-09. Four steps in order; each is verified before the next. Steps 1 and 2 are built. Step 3 waits on two credentials only the operator holds. Step 4 is a proposal in `plans/doppler-organization.md`.

## Summary

GitHub Actions reaches the EC2 host with `EC2_SSH_KEY`, a repository secret that a Doppler → GitHub sync delivers. On 2026-10-09 nothing arrives: [run 37960326401](https://github.com/Awannaphasch2016/dyad/actions/runs/37960326401) and [run 37974296078](https://github.com/Awannaphasch2016/dyad/actions/runs/37974296078) printed `github_ec2_ssh_key=absent` and `github_doppler_token=absent`. On 2026-10-02 the key was present and SSH worked ([run 37072073538](https://github.com/Awannaphasch2016/dyad/actions/runs/37072073538)), but the host's own Doppler token answered `Invalid Auth token`.

The key is in Doppler project `dyad`, config **`dev`** (operator, 2026-10-09). Every document and script in this repository says the sync comes from config `preview`. If that is still where the sync points, the sync can be healthy and still never deliver the key: it is not in the config being synced. The check now prints `github_sync_project=` and `github_sync_config=` from the `DOPPLER_PROJECT` / `DOPPLER_CONFIG` names the sync writes beside the secrets, so the run says which of the two it is. [Run 37975980373](https://github.com/Awannaphasch2016/dyad/actions/runs/37975980373) answered `github_sync_project=absent github_sync_config=absent`: neither name exists as a secret or a variable, so no Doppler sync is writing to this repository at all. The sync was removed or the Doppler GitHub app lost access; where the key sits in Doppler does not matter until a sync exists. Rather than restore the sync, the workflows now fetch from Doppler by OIDC (next section); the one remaining action is creating the Service Account Identity in the Doppler dashboard and committing its ID.

## Status

| Step                              | State                                                                                                                                                         | Evidence                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. GitHub Actions → EC2 → Doppler | GitHub → Doppler → EC2 works by OIDC ([run 37978419841](https://github.com/Awannaphasch2016/dyad/actions/runs/37978419841)); both host token files answer 401 | `.github/workflows/ec2-access-check.yml`, `.github/actions/doppler-oidc`, `scripts/gascity/check_host_access.py`         |
| 2. Operation AXI                  | Done                                                                                                                                                          | `packages/ops-axi`, 18 tests, in the toolbox image at `sha256:49e83dc6…`; the image test fails if the stub took the slot |
| 3. Role ARN in Doppler            | Blocked on step 1 and on a write-capable host token                                                                                                           | `ops-axi formula role` runs `preview-formula-role.yml`; `ops-axi formula verify` checks presence from the host           |
| 4. Doppler organization           | `status` runs from Actions by OIDC: `prd` fully sourced from `preview`; `ci` lacks `DOPPLER_TOKEN` and the role ARN; the identity cannot read `dev`           | `plans/doppler-organization.md`, `.github/workflows/doppler-organize.yml`                                                |

## Step 1: what the check proves

`ec2-access-check.yml` prints one fact per line and never a value:

```
github_ec2_ssh_key=present            fingerprint printed by ssh-keygen -l, not the key
github_doppler_token=http-200 project=dyad config=preview
ec2_ssh=ok
dyad_token=http-200 project=dyad config=prd      from /etc/doppler/dyad-preview.token
aws_token=http-200 project=aws config=dev        from /etc/doppler/aws-dev.token
dyad_secret_names=http-200 count=N
AWS_PREVIEW_FORMULA_ROLE_ARN=present|absent
EC2_SSH_KEY=present|absent
host_doppler=ok|broken
```

`ops-axi ec2 check` starts the workflow (or reruns its latest run when GitHub refuses to dispatch a file that is not on `main`), waits, and prints those lines. Exit 0 means every link holds.

## Step 2: what ops-axi is

`packages/ops-axi/README.md`. One command per operation: `ec2 check`, `formula role`, `formula verify`, `formula deploy`, `rollout <sha>`, `run <workflow.yml>`. It needs only `gh` and a token; it carries no AWS or Doppler credentials. It reads result lines back from the run log and redacts anything under a secret-looking key. It is in the toolbox image, so `docker run --rm -e GH_TOKEN ghcr.io/awannaphasch2016/axi-toolbox:0.1.36 ops-axi ec2 check` works from any machine with Docker.

## Step 3: how the ARN reaches Doppler

`preview-formula-role.yml` SSHes to the host and runs `scripts/gascity/setup_formula_role.py` there. The script reads the two root-owned token files, creates the OIDC provider and the `github-preview-formula` role with the `aws`/`dev` keys if they are missing, and writes `AWS_PREVIEW_FORMULA_ROLE_ARN` into the config its `dyad` token is bound to. It prints `doppler_write=http-NNN project=… config=…` and `AWS_PREVIEW_FORMULA_ROLE_ARN=stored`, never the ARN.

Two things must be true first:

- Step 1 passes, so the workflow can SSH.
- The host's `dyad` token is valid and can write. The current file is rejected outright (`Invalid Auth token`, 2026-10-02), so even the read fails. Doppler service tokens are read-only unless created with write access, so a replacement that only reads would get the script as far as the final `POST` and no further.

Then `ops-axi formula verify` runs the EC2 check and fails unless the host reports `AWS_PREVIEW_FORMULA_ROLE_ARN=present`. Once the Doppler sync delivers that name to GitHub, `ops-axi formula deploy` runs `preview-formula.yml`, which assumes the role through OIDC and prints `url=https://…`.

The existing config `dyad`/`preview` is kept as the destination. Reorganizing Doppler is step 4, after this path works.

## How the workflows reach Doppler without a sync

A Doppler → GitHub sync copies every secret of one config into the repository's Actions secrets so that `${{ secrets.EC2_SSH_KEY }}` has a value. The check shows no sync writes here today. Instead of restoring one, the workflows now authenticate to Doppler themselves: `.github/actions/doppler-oidc` exchanges the run's GitHub OIDC token for a short-lived Doppler API token through a **Service Account Identity** (`POST /v3/auth/oidc`). Nothing is stored in GitHub; the identity ID is a configuration value and lives in `deploy/doppler/identity`. With it:

- `ec2-access-check.yml` and `preview-formula-role.yml` download `EC2_SSH_KEY` from `dyad`/`preview` straight into the mode-600 key file when the GitHub secret is empty (`ec2_ssh_key_source=doppler-oidc`). They still prefer the synced secret when one exists.
- `doppler-organize.yml` runs `scripts/doppler/migrate.mjs status` on every push to this branch, and `phase1` + `verify` when dispatched with `command=phase1` or when the commit message contains `[doppler:phase1]`.

Service Account Identities are a Team-plan feature; the workplace is on the Team trial as of 2026-10-09. If the trial lapses to Free, fall back to the sync in the previous section of this plan's history: create a GitHub Actions sync from `dyad`/`preview` under the config's Config Syncs tab, and add a `DOPPLER_TOKEN` service token to that config.

## What you do

In this order. Nothing here is printed by any workflow, and none of it goes into git except the identity ID, which is not a secret.

1. **Create the identity** in Doppler (done 2026-10-09: `DOPPLER_SERVICE_IDENTITY_ID` is a repository variable and `doppler_oidc=http-200`). Workplace settings → Service Accounts → create one (name `github-actions`); give it access to project `dyad` with a role that can read `preview`, and create environments and write secrets (needed for Phase 1; a read-only role is enough for the SSH key alone). On its page, New identity → provider GitHub → claims: `aud` = `https://github.com/Awannaphasch2016`; `sub` = `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/axi-toolbox-image-plan-531e` and `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/formula-config-ui-55d6` (add more branches as value options as needed, or a wildcard `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/*` if you accept the wider match). Copy the identity ID it shows.
2. **Commit the ID** (optional while the repository variable is set): put the UUID on its own line in `deploy/doppler/identity` and push to `cursor/axi-toolbox-image-plan-531e`. (A repository variable `DOPPLER_SERVICE_IDENTITY_ID` works too and wins when both are set.) The push runs the EC2 access check and `doppler-organize status`. Expect `doppler_oidc=http-200`, `ec2_ssh_key_source=doppler-oidc`, `ec2_ssh=ok`, and `status` lines showing `ci=absent prd=absent` with everything sourced from `preview`.
3. **Replace the host token.** Create a service token for `dyad`/`preview` **with write access** and install it on the host: `sudo install -m 600 -o root -g root /dev/stdin /etc/doppler/dyad-preview.token`, paste, Ctrl-D. `plans/preview-token-rollout.md` records a replacement checked on 2026-10-03 but never installed; that one is read-only and will not do for step 5.
4. **Run `ops-axi ec2 check` again.** Expect `dyad_token=http-200 project=dyad config=preview` and `host_doppler=ok`.
5. **Run `ops-axi formula role`.** The role workflow lives on `cursor/formula-config-ui-55d6`, the base of PR #92; merging the PR puts the OIDC fallback there, after which a push to that branch (or `ops-axi formula role`, which reruns the latest run) uses it. Expect `AWS_PREVIEW_FORMULA_ROLE_ARN=stored`, then `ops-axi formula verify`: `AWS_PREVIEW_FORMULA_ROLE_ARN=present`.
6. **Run `ops-axi formula deploy`.** `preview-formula.yml` still reads `secrets.DOPPLER_TOKEN` and `secrets.AWS_PREVIEW_FORMULA_ROLE_ARN`; until that workflow also fetches by OIDC, either a sync from `ci` (after Phase 1) or those two repository secrets set by hand is needed. That is the one place a stored value remains.
7. **Phase 1 when you are ready**: push a commit with `[doppler:phase1]` in its message, or dispatch `doppler-organize.yml` with `command=phase1` once it is on `main`. Then read `plans/doppler-organization.md` for the later phases.

## Out of scope

- Changing which Doppler config the role script writes to; that is step 4.
- Making the operational workflows dispatchable from `main`. `ops-axi` handles the refusal by rerunning.
- Rotating `aws`/`dev` keys or the IAM role's trust policy.
