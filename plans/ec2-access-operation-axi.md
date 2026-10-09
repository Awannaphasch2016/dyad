# EC2 access, operation AXI, and the formula role ARN

> Written 2026-10-09. Four steps in order; each is verified before the next. Steps 1 and 2 are built. Step 3 waits on two credentials only the operator holds. Step 4 is a proposal in `plans/doppler-organization.md`.

## Summary

GitHub Actions reaches the EC2 host with `EC2_SSH_KEY`, a repository secret that a Doppler → GitHub sync delivers. On 2026-10-09 nothing arrives: [run 37960326401](https://github.com/Awannaphasch2016/dyad/actions/runs/37960326401) and [run 37974296078](https://github.com/Awannaphasch2016/dyad/actions/runs/37974296078) printed `github_ec2_ssh_key=absent` and `github_doppler_token=absent`. On 2026-10-02 the key was present and SSH worked ([run 37072073538](https://github.com/Awannaphasch2016/dyad/actions/runs/37072073538)), but the host's own Doppler token answered `Invalid Auth token`.

The key is in Doppler project `dyad`, config **`dev`** (operator, 2026-10-09). Every document and script in this repository says the sync comes from config `preview`. If that is still where the sync points, the sync can be healthy and still never deliver the key: it is not in the config being synced. The check now prints `github_sync_project=` and `github_sync_config=` from the `DOPPLER_PROJECT` / `DOPPLER_CONFIG` names the sync writes beside the secrets, so the run says which of the two it is. [Run 37975980373](https://github.com/Awannaphasch2016/dyad/actions/runs/37975980373) answered `github_sync_project=absent github_sync_config=absent`: neither name exists as a secret or a variable, so no Doppler sync is writing to this repository at all. The sync was removed or the Doppler GitHub app lost access; where the key sits in Doppler does not matter until a sync exists. Both fixes sit outside the repository. Everything that can be built around them is built; the checks that prove the fix are in place.

## Status

| Step                              | State                                               | Evidence                                                                                                                    |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1. GitHub Actions → EC2 → Doppler | Built; blocked on the Doppler sync                  | `.github/workflows/ec2-access-check.yml`, `scripts/gascity/check_host_access.py`; run 37960326401 shows both secrets absent |
| 2. Operation AXI                  | Done                                                | `packages/ops-axi`, 18 tests, in the toolbox image at `sha256:49e83dc6…`; the image test fails if the stub took the slot    |
| 3. Role ARN in Doppler            | Blocked on step 1 and on a write-capable host token | `ops-axi formula role` runs `preview-formula-role.yml`; `ops-axi formula verify` checks presence from the host              |
| 4. Doppler organization           | Proposed                                            | `plans/doppler-organization.md`                                                                                             |

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

## What you do

In this order. Nothing here is printed by any workflow, and none of it goes into git.

The agent VM has no Doppler token, no AWS keys, no SSH key, and a read-only GitHub token, so items 1 and 3 need you. If you add a Doppler CLI or service-account token for project `dyad` as a Cloud Agent secret named `DOPPLER_TOKEN` (Cursor Dashboard → Cloud Agents → Secrets), the agent can run `scripts/doppler/migrate.mjs` and the Phase 1 of `plans/doppler-organization.md` itself; the GitHub sync and the host file still need the dashboard and `sudo` on the host.

1. **Make the synced config hold the key.** Read `github_sync_config=` from the latest EC2 access check run.
   - `preview`: the sync is alive but `EC2_SSH_KEY` is in `dev`. In Doppler, open `dyad`/`dev`, `EC2_SSH_KEY`, and apply it to `preview` as well (one copy; the plan's Phase 1 later moves it to `ci` and `migrate.mjs` already looks in `dev` after `preview`). Do the same for `DOPPLER_TOKEN` if it is only in `dev`.
   - `absent`: no sync has written to this repository, or it was removed. In `dyad`, Integrations, create a GitHub Actions sync to `Awannaphasch2016/dyad` from the config that holds `EC2_SSH_KEY` and `DOPPLER_TOKEN`; `preview` after the copy above, or `ci` once Phase 1 has run.
   - `dev`: the sync comes from `dev` and still delivers nothing; recreate it.
     Confirm in GitHub, Settings → Secrets → Actions, that `EC2_SSH_KEY` and `DOPPLER_TOKEN` appear.
2. **Run `ops-axi ec2 check`** (or push to `cursor/axi-toolbox-image-plan-531e`). Expect `github_ec2_ssh_key=present` and `ec2_ssh=ok`. The host lines will still say `dyad_token=http-401` until the next item.
3. **Replace the host token.** Create a service token for `dyad`/`preview` **with write access** (`doppler configs tokens create formula-role --project dyad --config preview --plain`, choosing write in the dashboard, or a service-account token scoped to that config). On the host: `sudo install -m 600 -o root -g root /dev/stdin /etc/doppler/dyad-preview.token` and paste the token. `plans/preview-token-rollout.md` records that a replacement token was checked on 2026-10-03 but not installed; that one is read-only and will not do for step 3.
4. **Run `ops-axi ec2 check` again.** Expect `dyad_token=http-200 project=dyad config=preview` and `host_doppler=ok`.
5. **Run `ops-axi formula role`.** Expect `AWS_PREVIEW_FORMULA_ROLE_ARN=stored`. Then `ops-axi formula verify`: `AWS_PREVIEW_FORMULA_ROLE_ARN=present`. The sync delivers the new name to GitHub within a minute.
6. **Run `ops-axi formula deploy`.** Expect `url=https://…`. That is the first successful ECS formula preview.
7. Read `plans/doppler-organization.md` and decide whether to start its Phase 1.

## Out of scope

- Changing which Doppler config the role script writes to; that is step 4.
- Making the operational workflows dispatchable from `main`. `ops-axi` handles the refusal by rerunning.
- Rotating `aws`/`dev` keys or the IAM role's trust policy.
