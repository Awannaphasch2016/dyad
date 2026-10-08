# Merge and validate preview-forma

> This is a plan. It does not merge, does not deploy, and does not change Clerk.

The workflow file already exists on `cursor/preview-forma-workflow-5014` (draft PR 77). Merging that file to `main` makes **Run workflow** available. It does not make the `preview-forma` label start a job. A label on `Awannaphasch2016/forma` never reaches a workflow in this repository until Forma itself sends `repository_dispatch`.

## Status

### Tested

- Empty inputs fail before Doppler, Neon, or Vercel. Run [37801804857](https://github.com/Awannaphasch2016/dyad/actions/runs/37801804857).
- Pull request 2 deployed commit `80a8e419f6285378b4dfada336ea8213f3089bab` to https://forma-p2q19xkaj-anak2.vercel.app. Run [37802103230](https://github.com/Awannaphasch2016/dyad/actions/runs/37802103230). `GET /api/status` is `{"configured":true,"provider":"openrouter"}`. A wrong password returns 401.
- That run used Doppler `forma/dev`, Neon branch `forma-pr-2` on `ep-twilight-wildflower-b3fwtiew`, and the Vercel project `forma`. It updated `OPENROUTER_API_KEY`. It did not set `APP_URL` or any `OPENAI_*` name.
- `FORMA_ENVIRONMENT=canary` exits with `Only the preview environment is implemented` before Doppler.
- The credentials used by that deploy are present: `DOPPLER_ADMIN_TOKEN`, the dyad-harness app key, and Doppler `forma/dev` values for Neon, Vercel, OpenRouter, and the studio password. The app token was created with contents, pull requests, and workflows write on `forma`.

### Implemented, not exercised by a label

- `workflow_dispatch` inputs `sha`, `pr`, and `environment`.
- `repository_dispatch` type `preview-forma` with the same three fields.
- `commandForPullRequest(event, "preview-forma")` returns `update` or `destroy` in a unit test. No workflow calls it for a Forma pull request.
- The deploy comments the Forma pull request when `pr` is set. The job exited 0. This token cannot read the private comment body back. The repository is public now; the comment check can be repeated by opening pull request 2.
- **Publish Forma image** on `cursor/forma-preview-walkthrough` pushed `ghcr.io/awannaphasch2016/forma:sha-80a8e419f6285378b4dfada336ea8213f3089bab`. Forma's run [37768316995](https://github.com/Awannaphasch2016/forma/actions/runs/37768316995) logged `forma_image=ghcr.io/awannaphasch2016/forma@sha256:b9e58a3c060b99bcfe19426a9def8b5dfd145956d9effc6034d9e8c6239592b2`.

### Missing

- A Forma workflow that listens for the label `preview-forma`.
- A token in that Forma workflow that can `repository_dispatch` this repository.
- A down path: unlabel and close do not delete the Neon branch, the Vercel deployment, or a running job.
- Per-pull-request concurrency. The group is one global `preview-forma`.
- Packages read on the dyad-harness token, so the Dyad job can see the private GHCR manifest.
- Image publish for a pull request SHA other than the walkthrough branch tip.
- The shared Clerk sign-in. That is a separate plan and is not a preview blocker.

## What “not visible from this repository” meant

Forma is public. Its workflow file, Dockerfile, and Actions log were readable once this plan looked at `Awannaphasch2016/forma` instead of only the Dyad job log.

The Dyad deploy asks GHCR for the manifest with the Forma app token. That token does not have packages permission. GHCR returned 401, and the script logs `forma_image=unavailable`. An anonymous request for the same tag also returns 401, so the package is private even though the Git repository is public. The digest above comes from Forma's own Actions log, not from the Dyad job.

The preview URL is a Vercel upload of the git commit. Nothing runs the container. The image is a published artifact for that one commit.

## Lifecycle, expected and actual

| Step                                                            | Expected when the label is the control                                                           | Actual today                                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Add `preview-forma` to an open Forma pull request            | This repository's `preview-forma` workflow starts                                                | Nothing starts. Label events do not cross repositories. This was not tested by adding the label.                                                                                                                                             |
| 2. The correct workflow runs                                    | `preview-forma`                                                                                  | Only `workflow_dispatch` and `repository_dispatch` are implemented. The proof was a temporary push, since removed.                                                                                                                           |
| 3. The commit's GHCR image is resolved or built                 | Digest logged, or **Publish Forma image** runs for that SHA                                      | One image exists, for `80a8e419…` only. Publish runs on a push to `cursor/forma-preview-walkthrough`. `forma` `main` has a Dockerfile and no workflow. The Dyad job cannot read the private manifest. The public URL does not run the image. |
| 4. Preview database exists                                      | Neon branch `forma-pr-<number>` under `divine-credit-21002460`, parent `br-round-night-b33xeq5p` | Done for pull request 2. The parent was not printed because the branch already existed. The script refuses any other parent.                                                                                                                 |
| 5. Exact pull request commit is deployed                        | Vercel preview of that SHA                                                                       | Done for `80a8e419…` by passing `pr=2`. Not done by a label.                                                                                                                                                                                 |
| 6. Public URL                                                   | `https://forma-….vercel.app`                                                                     | https://forma-p2q19xkaj-anak2.vercel.app                                                                                                                                                                                                     |
| 7. The app answers                                              | OpenRouter status, wrong password 401                                                            | Both checked on that URL.                                                                                                                                                                                                                    |
| 8. A new commit on the labeled pull request updates the preview | A new deploy of the new SHA                                                                      | Not implemented and not tested. A later manual dispatch could deploy a new SHA. A push does not.                                                                                                                                             |
| 9. Removing the label cleans up                                 | Running deploy stops. Neon branch and preview URL for that pull request go away.                 | Not implemented. The job has no unlabel trigger. `cancel-in-progress` is false. The previous plan deferred this. It was not proven.                                                                                                          |
| 10. Closing or merging the pull request cleans up               | Same resources as unlabel, and only for a pull request that had the label                        | Not implemented and not tested. Pull request 2 is still open. `forma-pr-2` still exists. The Vercel URL still answers. The GHCR tag still exists.                                                                                            |

`commandForPullRequest` would return `destroy` for an unlabel or a close if something called it. Nothing does. Closing every Forma pull request must not destroy a preview: only a pull request that carries `preview-forma` should send `down`.

## Prerequisites before merge

Already satisfied for a manual deploy:

- Doppler project `forma`, config `dev`.
- Neon project `divine-credit-21002460` and parent `br-round-night-b33xeq5p`.
- Vercel project `forma`, preview target only.
- dyad-harness app id `5221649`, installation that can write contents, pull requests, and workflows on `forma`.
- GitHub environment `ai-bots` and secret `DOPPLER_ADMIN_TOKEN`.

Still to confirm before the label can be the control. If one of these is missing, stop and name it. Do not run a label test that cannot succeed.

1. dyad-harness is installed on **this** repository, not only on `forma`. Forma's `GITHUB_TOKEN` cannot send `repository_dispatch` here. The sender needs an installation token whose repository is `dyad` and whose contents permission can create a dispatch.
2. Packages: Read is granted on dyad-harness for `forma`, if the Dyad log is required to print the digest. Until then the digest stays in Forma's **Publish Forma image** log. Do not request `packages: write` from the Dyad job. Requesting a permission the installation does not grant fails token creation for the whole job.
3. The label `preview-forma` exists on `Awannaphasch2016/forma`.
4. Shared Clerk sign-in is out of this merge. Bolt's plan (`plans/shared-auth-substrate.md` on `cursor/shared-auth-substrate-55d6`, PR 76) says Forma copies the adapter only after Bolt's two-person check passes. That check has not passed. Forma still uses its studio password. `bolt.diy` has no Clerk adapter. Do not copy that sign-in into Forma as part of preview.

## Changes required before merging

On `cursor/preview-forma-workflow-5014`, before it merges:

1. Accept `action` on `repository_dispatch`: `up` or `down`. `workflow_dispatch` remains `up`.
2. Concurrency group `preview-forma-<pr>` with `cancel-in-progress: true`.
3. `down` deletes Neon branch `forma-pr-<number>` only. Refuse the parent `br-round-night-b33xeq5p`, project `proud-salad-68182047`, and host `ep-young-wave-b3cwe0rz`.
4. `down` deletes the Vercel preview deployments for that pull request SHA. Leave any deployment whose target includes production.
5. `down` comments the pull request that the preview was removed. It does not delete the GHCR tag. Images are content-addressed and the next preview of that commit can reuse them.
6. Before `up` writes the URL, re-read the Forma pull request. If `preview-forma` is gone, do not create a new deployment. This stops an in-flight deploy from recreating resources after an unlabel.
7. Unit tests for `up`, `down`, a close without the label, and a SHA that does not match the pull request head.

In `Awannaphasch2016/forma`, a second change, merged to `forma` `main` before the label test:

1. `.github/workflows/preview-forma-label.yml`.
2. Triggers: `pull_request` types `labeled`, `unlabeled`, `synchronize`, `closed`.
3. Sends `repository_dispatch` type `preview-forma` to `Awannaphasch2016/dyad` with `pr`, `sha`, and `action`.
4. `labeled` and `synchronize` while the label is present send `up`. `unlabeled` of `preview-forma`, and `closed` while the label is present, send `down`. Any other label is ignored.
5. The workflow uses the dyad-harness installation token. It does not put a personal token in the repository.

Image publish stays a recorded artifact. Do not switch the public URL off Vercel in this merge. A later change can make **Publish Forma image** build the labeled SHA. That workflow currently builds only the walkthrough branch tip.

Leave `cursor/forma-pr-preview-5014` unmerged. Its file is why **PR Preview - Forma** still appears in Actions. It does not run unless that branch is pushed. Do not push it.

## Merge strategy

1. Finish the `up`/`down` changes and tests on the Dyad feature branch. Open that as the merge candidate. Do not merge PR 77 as it stands.
2. Confirm the three prerequisites above. A missing installation or a missing packages grant is a blocker, not a failed run.
3. Merge the Dyad workflow to `main`. GitHub then lists the workflow under the file's `name:` key, `preview-forma`. **Run workflow** becomes available to people who can dispatch this repository. This agent's token cannot dispatch (HTTP 403) and is not the test.
4. Merge the Forma label sender to `forma` `main`. A sender that exists only on a feature branch does not hear labels on other pull requests.
5. Then run the label test. Do not use pull request 2 for the delete test. That Neon branch is the known-good preview.

## Label test

Use a new Forma pull request.

1. Add `preview-forma`.
2. This repository shows a `preview-forma` run whose payload `pr` and `sha` are that pull request's head.
3. The log shows `forma_sha` equal to that head, `forma_source=commit`, and `forma_url`.
4. `GET /api/status` reports OpenRouter. A wrong password returns 401.
5. Push a new commit. A second run deploys the new SHA. The pull request comment shows the new URL and the new SHA.
6. Remove the label. The run logs `down`. `forma-pr-<number>` is gone. The preview URL no longer serves the app. The parent branch remains.
7. Open another labeled pull request, then close it. The same `down` result happens. An unlabeled pull request that closes does not delete a Neon branch.

Record each row as pass or the first log line that failed. Do not mark the lifecycle done from the pull request 2 deploy alone.

## Shared sign-in

Forma is not on the shared Clerk sign-in. The Bolt plan keeps Forma, Vibe SDK, and the rest of DYAD unchanged until Bolt's two-person check passes. Preview keeps the studio password. Distributing Clerk into Forma is a later plan, after that check, and it is not required to merge this workflow.
