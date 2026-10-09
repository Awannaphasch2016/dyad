# Use the EC2 host to store the formula role in Doppler

The production host already has Doppler token files. Use those files to create the formula preview role and write `AWS_PREVIEW_FORMULA_ROLE_ARN` back into Doppler. The private SSH key stays out of the git repository. GitHub Actions only has the placeholder `${{ secrets.EC2_SSH_KEY }}`.

Do not run Gas City rollout for this. That workflow SSHs in and then rebuilds the production container.

## What you can check

1. **Formula preview role** prints `ssh key source=github` or `ssh key source=doppler`. The log does not print the key.
2. That run prints `doppler secrets set AWS_PREVIEW_FORMULA_ROLE_ARN ok` and `setup-formula-role done`. The log does not print the AWS keys or the role ARN.
3. That run does not execute `gascity-rollout`.
4. **Preview formula** then reads `AWS_PREVIEW_FORMULA_ROLE_ARN` from Doppler and prints the load balancer URL.

## Which workflow to reuse

| Workflow             | File                       | Use for this                                                                                                                           |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Gas City rollout     | `gascity-rollout.yml`      | Copy the SSH steps only. Do not run the workflow. It deploys production.                                                               |
| Formula preview role | `preview-formula-role.yml` | This is the reusable job. It already SSHs with the same key, known hosts, and host, then runs `scripts/gascity/setup_formula_role.py`. |
| Preview formula      | `preview-formula.yml`      | Reads the stored name from Doppler afterward. It does not SSH.                                                                         |

The Actions secrets `EC2_SSH_KEY` and `DOPPLER_TOKEN` are empty on this repository. **Bolt preview from Doppler** already reads Doppler with `DOPPLER_ADMIN_TOKEN`. **Formula preview role** uses that token to read `EC2_SSH_KEY` from `dyad` / `preview`, then opens the host shell. The host token files returned HTTP 401, so the same job reads project `aws` config `dev` with the admin token, creates the role, and runs `doppler secrets set AWS_PREVIEW_FORMULA_ROLE_ARN` into `dyad` / `preview`.

Gas City rollout's SSH shape is the pattern already copied:

- `scripts/gascity/prepare_ec2_ssh_key.py` writes the secret to a mode-600 file and does not print it.
- `.github/gascity_known_hosts` is the server's public host key.
- The login is `ubuntu@13.251.216.187`.
- On the host, `/etc/doppler/dyad-preview.token` and `/etc/doppler/aws-dev.token` are the Doppler logins. GitHub does not receive those tokens.

## Direction

1. **Formula preview role** logs in with `EC2_SSH_KEY` when that Actions secret is set. When it is empty, the same job downloads the key from Doppler with `DOPPLER_TOKEN` and does not print it.
2. The host creates role `github-preview-formula`, trusts `repo:Awannaphasch2016/dyad:ref:refs/heads/cursor/formula-config-ui-55d6`, and runs `doppler secrets set AWS_PREVIEW_FORMULA_ROLE_ARN` into the Doppler config that `/etc/doppler/dyad-preview.token` belongs to.
3. Leave **Gas City rollout** unchanged so a formula setup cannot rebuild production.
4. Leave **Preview formula** as the consumer. It already waits for that Doppler name and assumes it.

## Every workflow on this branch

The README table is older than this branch. These are the files in `.github/workflows/` now.

| File                                      | Name                                | Reuse                                                                  |
| ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| `gascity-rollout.yml`                     | Gas City rollout                    | SSH pattern only. Running it deploys production.                       |
| `preview-formula-role.yml`                | Formula preview role                | Reuse this job.                                                        |
| `preview-formula.yml`                     | Preview formula                     | Consumer of the Doppler name. No SSH.                                  |
| `preview-image.yml`                       | Preview image                       | DevBox and Doppler from GitHub. No EC2 shell.                          |
| `preview.yml`                             | Preview                             | DevBox and Doppler from GitHub. No EC2 shell.                          |
| `preview-exec.yml`                        | Preview exec                        | DevBox only. The file says it does not read the production deploy key. |
| `preview-secrets.yml`                     | Preview secrets                     | DevBox public key. No production SSH.                                  |
| `preview-wake.yml`                        | Preview wake                        | Starts DevBox containers that are already there.                       |
| `ci.yml`                                  | CI                                  | Tests and builds. No Doppler write, no EC2.                            |
| `ci-desktop.yml`                          | Desktop CI                          | Desktop checks. No EC2.                                                |
| `cla.yml`                                 | CLA Assistant                       | Pull request signatures.                                               |
| `claude-pr-review.yml`                    | Claude PR Review                    | Review bot.                                                            |
| `claude-check-workflows.yml`              | Claude Check Workflows              | Workflow review bot.                                                   |
| `claude-deflake-e2e.yml`                  | Claude Deflake E2E                  | Test cleanup bot.                                                      |
| `claude-rules-review.yml`                 | Claude Rules Review                 | Rules review bot.                                                      |
| `claude-triage.yml`                       | Issue Triage                        | Issue labels.                                                          |
| `codex-pr-review.yml`                     | Codex PR Review                     | Review bot.                                                            |
| `closed-issue-comment.yml`                | Closed Issue Comment Handler        | Issue comments.                                                        |
| `close-stale-prs.yml`                     | Close stale PRs                     | PR housekeeping.                                                       |
| `draft-stale-prs.yml`                     | Draft stale PRs                     | PR housekeeping.                                                       |
| `cancel-ci-after-merge.yml`               | Cancel CI after merge               | Cancels CI.                                                            |
| `cancel-claude-pr-review-after-merge.yml` | Cancel Claude PR Review after merge | Cancels review.                                                        |
| `playwright-comment.yml`                  | Playwright Report Comment           | CI comment.                                                            |
| `pr-review-alerts.yml`                    | PR Review Alerts                    | Mail alert.                                                            |
| `pr-status-labeler.yml`                   | PR Status Labeler                   | Labels.                                                                |
| `github-security-advisory-alerts.yml`     | GitHub Security Advisory Alerts     | Mail alert.                                                            |
| `nightly-runner-cleanup.yml`              | Nightly Runner Cleanup              | macOS CI runners, not this EC2 host.                                   |
| `release.yml`                             | Release app                         | Signed desktop release.                                                |
| `remove-unauthorized-release.yml`         | Remove Unauthorized Release         | Deletes a bad release.                                                 |

The README also names `bugbot-trigger.yml`, `claude-rebase.yml`, `label-rebase-prs.yml`, `merge-pr.yml`, and `pr-review-responder.yml`. Those files are not in this branch, so they are not part of the reuse set.
