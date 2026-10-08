# Harness equivalence experiments

Written 2026-10-07. These experiments ask whether a Harness pipeline can run the same build, test, preview, and rollout behavior this repo already runs in GitHub Actions. A feature checklist is not a result. Each experiment keeps the existing scripts and external systems, points a Harness pipeline at them, and compares the two runs.

Experiment 2 matched the corrected pull requests: a rules-only change skipped the tests, a schema-diff change ran that package’s tests, and a `src/` change ran the app fast-check and skipped the schema jobs. GitHub Actions remains the required check. Experiment 14 has a partial log and status check, and it is not a pass. Experiment 1 has a passing GitHub Actions image pair and a Harness login. The GitHub App token includes `packages=write`, and GHCR still refuses the push. Experiment 1 is blocked on a classic personal access token. Experiments 3–13 and 15 are still `not run`. Do not treat the substitution matrix as a decision until the named experiments pass.

## Ground rules

- Store the Harness pipeline in git. A pipeline that exists only in the Harness UI fails the agent experiment before it starts.
- Doppler remains the only secret store. The Harness run exchanges its own OIDC token for a short-lived Doppler token. It does not copy `dyad/preview`, `dyad/canary`, or `dyad/prd` into Harness or into GitHub Actions secrets.
- Harness account `WKxXBnSFTRaOF64-h90PyQ` (`anakwannaphaschaiyong`) on `app.harness.io` accepted `HARNESS_API_KEY` on 2026-10-07. Run [37596184593](https://github.com/Awannaphasch2016/dyad/actions/runs/37596184593) printed the account id and did not print the token. Doppler identities for that issuer are not created yet.
- Production host `13.251.216.187` and `gascity-rollout.yml` stay out of every experiment except 10, and experiment 10 uses a copy of the rollout on a non-production Docker engine.
- Harness Kubernetes canary, Argo Rollouts, and Lambda traffic shifting are different systems. They do not pass experiments 8, 9, or 10.
- Logs print host labels, status codes, and image digests. They do not print connection strings or tokens.
- GitHub Actions keeps running as the required check until experiment 2 has matched it on three consecutive pull requests.

## How a row is scored

| Column      | What to write                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------- |
| Current     | The workflow file, trigger, and the behavior just observed on GitHub Actions                  |
| Harness     | The pipeline file, trigger, and which existing script it calls                                |
| Expected    | The acceptance check below                                                                    |
| Actual      | The observed digest, command, status code, or log line. `not run` until then                  |
| Pass        | pass or fail. A missing log is a fail                                                         |
| Performance | Wall clock next to the GitHub Actions run it is compared with                                 |
| Cost        | GitHub Actions minutes and Harness build credits for that run. No estimate in place of a bill |
| Complexity  | Files touched, and whether a person had to use the Harness UI                                 |
| Gaps        | Behavior the Harness run did not reproduce                                                    |

## What the current system actually is

| Concern                  | Current implementation                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required CI on this fork | `.github/workflows/ci.yml` job `fast-check`. Electron, macOS, and Windows jobs run when `github.repository == 'dyad-sh/dyad'`. This fork starts them from `.github/workflows/ci-desktop.yml`.                                                                                                                                  |
| Dyad image               | `Dockerfile.gascity`. Tags `ghcr.io/<owner>/dyad:ctx-<hash>` and `dyad:sha-<commit>`. The hash is `scripts/gascity/preview-image-id.mjs`.                                                                                                                                                                                      |
| Gas City image           | `.github/workflows/gascity-image.yml` builds `Awannaphasch2016/gascity` `contrib/k8s/Dockerfile.base` and `Dockerfile.agent`. Tags `ghcr.io/awannaphasch2016/gascity:sha-<sha>` and `:preview`.                                                                                                                                |
| Preview                  | `.github/workflows/preview.yml` on pull request `opened`, `synchronize`, `reopened`, `closed`, `labeled`, `unlabeled`. `deploy/preview/transition.mjs` returns `update`, `destroy`, or `skip`. The runtime is Compose project `preview-<pr>` on Namespace Devbox `Wewebplus-ci`, hostname `pr-<pr>.anakwannaphaschaiyong.com`. |
| Preview database         | `deploy/preview/neon.mjs` creates Neon child `preview-pr-<pr>` of `Wewebplus-hitl` / `Dev`. Vercel project `dyad` receives `WEWEBPLUS_DATABASE_URL` on the Preview target for that git branch only.                                                                                                                            |
| Secrets                  | `dopplerhq/secrets-fetch-action` with GitHub OIDC. Preview reads `dyad/preview` and `aws/dev`. Production identity `5a844bf1-8def-47f4-8ae1-9520f7bf109b` reads `dyad/prd` only from `main`.                                                                                                                                   |
| Production deploy        | `.github/workflows/gascity-rollout.yml` waits until `ci.yml` succeeds, then SSHs to `ubuntu@13.251.216.187` and runs `gascity-rollout`. `scripts/gascity/rollout.sh` tags `weaver-plus:gascity-previous` and restores it if the new container does not become healthy or port 8373 does not open.                              |
| Canary                   | Designed on `cursor/ecs-hitl-cutover-bbea` in `plans/pre-promotion-verification.md`. It is not a workflow on `main`. The canary is one ECS task on cluster `wewebplus`, shared memory 1024, Gas City calling `http://dyad:32100`, Doppler `dyad/canary`. A pass does not move the apex.                                        |

## Experiments

### 1. Build the same images

**Current.** `Publish Gas City image` (`.github/workflows/gascity-image.yml`) on `workflow_dispatch` or a push of that workflow. `Preview` and `Preview image` build `Dockerfile.gascity` with `docker/build-push-action`, provenance and SBOM off.

**Harness.** One CI pipeline with two stages. Stage A checks out `Awannaphasch2016/gascity` and runs the same `go build`, `Dockerfile.base`, and `Dockerfile.agent` build. Stage B checks out this repo and runs `docker build` on `Dockerfile.gascity`. Push to the same GHCR repositories under a `harness-` tag prefix so the experiment cannot move `:preview` or `:sha-<commit>` until the digest check passes.

**Expected.**

- `gc version` inside the Harness Gas City image matches the GitHub Actions image built from the same fork SHA.
- Both Dyad images use the same Dockerfile, the same lockfile, and the same health check: `GET /vnc.html` succeeds and unauthenticated `GET /v1/apps/0/factory-state` returns 401.
- Image config digest matches for entrypoint, exposed ports, and environment. Layer bytes may differ. A byte-different layer is a pass only when the config contract matches. A different entrypoint, user, or health check is a fail.
- The Harness build does not push to ECR and does not SSH.

**Actual.** Not scored. GitHub Actions run [37693544766](https://github.com/Awannaphasch2016/dyad/actions/runs/37693544766) built both images. Gas City reused `ghcr.io/awannaphasch2016/gascity:harness-gha-d47f1d3f3069` (`user=gcagent`, `gc` printed `dev`, no health check). Dyad `harness-gha-ctx-36a4e6986720` returned `factory_state_status=401` and `health=pass` with entrypoint `/app/docker/gascity-entrypoint.sh`, user `weaver`, and port `6080/tcp`. Harness execution `ZddHTr__QG62UP1jpsBayQ` logged in to GHCR with connector secret `account.Dyad_harness1`, then the Dyad push was denied: `installation not allowed to Write organization package`. The Gas City stage stopped because `br` needs glibc 2.39 and the Harness runner does not have it. The host no longer executes `br`. The GitHub App installation already lists packages read and write, and that page has no pending-permission banner. Auth probe execution `Km6NQGuHTHyDgHwZ6HxM8Q` confirmed the installation and the minted token both have `packages=write`. Docker login succeeded. `GET` of the public packages `dyad`, `gascity`, and `gascity-base` returned 200, and all three are linked to `Awannaphasch2016/dyad`. The scratch push to `ghcr.io/awannaphasch2016/dyad:harness-authprobe` was still `denied_organization_package`. The image build stays stopped until a classic `write:packages` token can push that tag.

### 2. Run the same tests

**Current.** `CI` (`.github/workflows/ci.yml`):

- `check-changes` skips tests when every changed file is under `.claude/` or `rules/`. It runs `packages/ts-pg-schema-diff` and `packages/pg-schema-classifier` only when those trees change. Push to `main` always runs app tests.
- `fast-check` runs `npm run presubmit`, `npm run ts`, `npm test -- src/main/browser_bridge.test.ts src/control_plane/file_sync.test.ts`, and `bash scripts/gascity/rollout.test.sh`, on Node 24.13.1 and npm 11.8.0.
- Schema jobs start Postgres 16.
- `cancel-in-progress` is true for the same pull request.
- `Desktop CI` is the Electron matrix and is manual on this fork.

**Harness.** A pipeline whose steps are those exact commands, in that order, with the same Node version. Path filters use the same directory rules. A second manual pipeline runs `ci-desktop.yml`'s matrix on one pull request only after `fast-check` matches.

**Expected.**

- Three pull requests: one docs-only change under `rules/`, one change under `packages/ts-pg-schema-diff/`, one change to `src/`. Harness skips, runs, and fails the same jobs GitHub Actions skips, runs, and fails.
- A pushed commit cancels the older Harness execution for that pull request.
- `fast-check` failure fails the pipeline. A skipped Electron matrix does not.
- Exit codes match. A Harness step that reports success after a non-zero test command is a fail.

**Actual.** Matched on the corrected pull requests. The first webhook round cloned `cursor/harness-equivalence-5527` because the pipeline hardcoded that branch, so pull requests 55, 53, and 54 all ran the app tests and skipped both schema stages. That round is not the score. The codebase build is now a runtime input, the trigger passes `<+trigger.prNumber>`, and `prCloneStrategy` is `SourceBranch`. Each probe branch was then merged with the equivalence branch so the pull request diff is only the probe file.

- Pull request 55, `cursor/harness-rules-only-5527` at `7830311f`. GitHub Actions [37637696349](https://github.com/Awannaphasch2016/dyad/actions/runs/37637696349) skipped `fast-check` and both schema jobs. Harness `v4k6khxBTx6MJ8wEfKF9Mg` checked out that source branch, set `should_run_tests=false` and both schema flags false, skipped `presubmit` and `typecheck`, and skipped both schema stages. The `fast_check` stage status is Success because the change check is inside that stage. Wall clock about 13 seconds versus 35 seconds.
- Pull request 53, `cursor/harness-schema-diff-5527` at `399538fd`. GitHub Actions [37637696754](https://github.com/Awannaphasch2016/dyad/actions/runs/37637696754) ran `fast-check` and `ts-pg-schema-diff-tests` and skipped the classifier. Harness `FSjygwCbRpKfRLFtUG2N7Q` did the same, including Postgres 16, `pg_dump`, the unit tests, and the integration tests. Wall clock 193 seconds versus 230 seconds.
- Pull request 54, `cursor/harness-src-change-5527` at `edea4700`. GitHub Actions [37637701704](https://github.com/Awannaphasch2016/dyad/actions/runs/37637701704) ran `fast-check` and skipped both schema jobs. Harness `4zEFjfPrRLyXhoe5GgBrJg` did the same. Wall clock 101 seconds versus 99 seconds.

A second push on pull request 54 aborted Harness `TguuFeKMTBuWTiaDSN7s7g` when `cGTuhnmxRFG5fC4QC0UDFQ` started. The Electron matrix stayed skipped on this fork. Execution `nI911DyPQC2Gd1sIV6yQOw` still shows that a non-zero step fails the pipeline. No paired failing test was injected. GitHub Actions remains the required check. Cost is blank because no bill was read.

### 3. Preview from a pull request

**Current.** `Preview` (`.github/workflows/preview.yml`). `deploy/preview/controller.mjs decide` calls `commandForPullRequest`. `update` resolves an image, runs `deploy/preview/controller.mjs attach`, and execs Devbox `Wewebplus-ci`. The production host is not a target.

**Harness.** A GitHub trigger for Pull Request actions Open, Synchronize, Reopen, Close, Label, and Unlabel. The first step runs `node deploy/preview/controller.mjs decide` and continues only for `update`. The deploy step runs the same Devbox exec the workflow runs today.

**Expected.**

- A labeled test pull request gets Compose project `preview-<pr>`, hostname `https://pr-<pr>.anakwannaphaschaiyong.com`, and Neon branch `preview-pr-<pr>`.
- Factory port 32100 is not published on the public hostname.
- `https://anakwannaphaschaiyong.com` still serves the current production window.
- The Harness execution log contains the same `command=update` line the GitHub Actions log contains.

**Actual.** not run.

### 4. Reuse an image when the source is unchanged

**Current.** `preview.yml` job `identify` runs `node scripts/gascity/preview-image-id.mjs`. If `ghcr.io/<owner>/dyad:ctx-<hash>` already exists, the job retags `dyad:sha-<commit>` onto that digest and sets `needs_build=false`. `publish` runs only when `needs_build` is true. Concurrency group `preview-build-<hash>` keeps one build per context.

**Harness.** Call the same script. Build only when it reports a missing tag. Harness Cache Intelligence or layer cache may run in addition. It does not replace the tag check.

**Expected.**

- Two commits that do not change the Docker context produce one build and two `sha-<commit>` tags pointing at the same digest.
- A commit that changes `Dockerfile.gascity` or a file included by `preview-image-id.mjs` produces a new digest.
- The reused run's wall clock is the inspect-and-retag time, not the image build. The GitHub Actions identify job is the comparison.
- A Harness cache hit that still runs `docker build` for an unchanged context is a fail.

**Actual.** not run.

### 5. Read Doppler without copying secrets

**Current.** Preview jobs use `dopplerhq/secrets-fetch-action` with `auth-method: oidc`, `vars.DOPPLER_SERVICE_IDENTITY_ID`, project `dyad`, config `preview`, and `id-token: write`. The production read workflow uses identity `5a844bf1-8def-47f4-8ae1-9520f7bf109b` and subject `repo:Awannaphasch2016@28061800/dyad@1384672033:ref:refs/heads/main`. The job prints secret names and the database host label.

**Harness.** Create a Doppler service-account identity whose discovery URL is `https://<harness-cluster>/ng/api/oidc/account/<account-id>`. Claims are exact: audience, pipeline identifier, and environment. The pipeline calls `https://app.harness.io/ng/api/oidc/id-token/custom` from the execution, then `POST https://api.doppler.com/v3/auth/oidc`. Print the host label with `scripts/gascity/canary-hosts.mjs` once that file is on the branch under test. Until then, print only the URL host.

**Expected.**

- The Harness execution log shows `db_endpoint=` and never shows `postgres://` or a Doppler token.
- Harness secret manager has no `WEWEBPLUS_DATABASE_URL`, Clerk secret, or Cloudflare token after the run.
- A pipeline whose identity is bound to `dyad/preview` receives the preview host and is rejected for `dyad/prd`.
- A wildcard subject fails the experiment even if the fetch succeeds.

**Actual.** not run.

### 6. Keep dev, preview, canary, and production isolated

**Current.**

| Environment  | Doppler config                     | Who may read it                                                                                                                 |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Preview      | `dyad/preview` and `aws/dev`       | Preview identity. Subject is pinned to this repo's pull-request or `cursor/*` ref, not `*`                                      |
| Canary       | `dyad/canary`                      | Service account `wewebplus-canary`, intended subject is `.github/workflows/canary-verify.yml` on `cursor/ecs-hitl-cutover-bbea` |
| Production   | `dyad/prd`                         | Identity `5a844bf1-8def-47f4-8ae1-9520f7bf109b` from `main` only                                                                |
| Dev database | Neon `Wewebplus-hitl` branch `Dev` | Parent of preview children. Production data is not this branch                                                                  |

The canary host label is `ep-muddy-sky-b31adt7z-pooler`. The production host label is `ep-young-wave-b3cwe0rz-pooler`. `Wewebplus-hitl` branch `prd` is `ep-royal-term-b3paoprp` and is neither of those.

**Harness.** Four pipelines, four Doppler identities, four exact claim sets. No shared Harness secret. No shared service account.

**Expected.**

- Each pipeline prints only its own host label.
- Preview cannot read canary or production. Canary cannot read production. Production cannot read preview.
- Two Harness environments named preview and production are a fail if they still share one Doppler token.
- The canary pipeline refuses to start when its database host equals the production host.

**Actual.** not run.

### 7. Neon preview branch

**Current.** `deploy/preview/neon.mjs` names the child `preview-pr-<pr>` under project `mute-credit-71067312`, parent `br-mute-shadow-b3jxqoho`. `deploy/preview/vercel.mjs` writes `WEWEBPLUS_DATABASE_URL` to Vercel project `dyad`, Preview target, that git branch only. `destroy` deletes that variable and that child. The Production target is not written.

**Harness.** The preview pipeline calls `node deploy/preview/controller.mjs attach` and, on destroy, the same controller's destroy path. Harness does not create a database with its own schema step.

**Expected.**

- Pull request A and pull request B each have their own Neon branch and their own Vercel Preview variable.
- An answer written through A is absent from B and from the production database.
- The Vercel Production environment's `WEWEBPLUS_DATABASE_URL` is unchanged before and after the run.
- Destroy removes A's branch and A's Preview variable, and leaves B in place.

**Actual.** not run.

### 8. Deploy and connect Gas City and Dyad

**Current preview contract.** Compose project `preview-<pr>` on Devbox `Wewebplus-ci`. Dyad serves the browser. Gas City uses `WEAVER_BASE_URL=http://dyad:32100` on that Compose network. The public tunnel serves the Dyad window. Port 32100 is not a public listener. The preview stand-in `services/gascity-browser` listening on 8787 is not this contract.

**Current production contract.** One container `weaver-plus` on `gascity-server` with host networking. The factory bridge listens on `127.0.0.1:32100`. The browser bridge listens on `127.0.0.1:8373`. Shared memory for the Dyad image is 1024. Rollout does not publish 32100.

**Canary contract, not yet running on main.** ECS cluster `wewebplus`, one task, `desiredCount` 1, `linuxParameters.sharedMemorySize` 1024, Service Connect name `dyad`, volumes that are not `/opt/gascity`. Security group `sg-0d19518d244fede2d` has no public 32100, 6080, or 8373.

**Harness.** Reproduce the preview contract first, by running the existing Compose project. A second pipeline may register the ECS task from `deploy/canary/task_definition.mjs` only on the canary branch, and only against cluster `wewebplus`.

**Expected.**

- From inside the preview network, unauthenticated factory-state returns 401 and an authenticated machine call reaches Dyad at `http://dyad:32100`.
- From outside, TCP to 32100 fails.
- `GET` of the public preview hostname returns the Dyad window.
- A Harness Kubernetes deployment with a Service named `dyad` is a fail for this experiment.

**Actual.** not run.

### 9. Canary, then promote only after checks

**Current.** There is no canary promotion on `main`. `gascity-rollout.yml` replaces the production container after `ci.yml` succeeds. The canary plan says a proof question on `https://pre.anakwannaphaschaiyong.com` must pass, and the apex stays on `gascity-server` until a later, separate change.

**Harness.** A pipeline with two stages. Stage 1 deploys the canary task and runs the health pair from `plans/pre-promotion-verification.md`: `/vnc.html` succeeds, unauthenticated factory-state returns 401, port 8373 accepts, and the browser-bridge marker is present. Stage 2 promotes only when those checks pass. Promotion is a separate manual stage during the experiment, and it is not executed against the apex.

**Expected.**

- A healthy canary leaves the apex on the current production window.
- A failed health check leaves `desiredCount` of the canary service at 0 or rolls that service back, and does not start stage 2.
- The pipeline log says promotion was not performed.
- Harness marking the canary stage green because a Kubernetes probe passed, without the factory-state 401 check, is a fail.

**Actual.** not run.

### 10. Bad deploy and rollback

**Current.** `scripts/gascity/rollout.sh` tags the running image as `weaver-plus:gascity-previous`, builds, and waits up to 48 times 5 seconds for `healthy` plus a TCP connection to `127.0.0.1:8373`. On failure the ERR trap retags `gascity-previous` back to `weaver-plus:gascity` and runs `docker compose up -d --no-build --force-recreate`. If the previous tag is missing, the script leaves the current container and exits non-zero.

**Harness.** Run that script on a disposable Docker engine with a known-good image, then deploy a Dockerfile whose health check never passes. Do not point this pipeline at `13.251.216.187`.

**Expected.**

- The bad container does not stay in `healthy`.
- After the pipeline finishes, the running container is the previous image id.
- The pipeline execution is failed, not green with a warning.
- A second writer is not left running beside the restored container.
- If Harness rollback needs a Kubernetes revision and cannot restore `weaver-plus:gascity-previous`, the experiment fails.

**Actual.** not run.

### 11. Pull request open, update, merge, and close

**Current.** `commandForPullRequest` in `deploy/preview/transition.mjs`:

| Event                                                             | Command   |
| ----------------------------------------------------------------- | --------- |
| `labeled` with `preview` on an open pull request                  | `update`  |
| `opened`, `synchronize`, or `reopened` while `preview` is present | `update`  |
| `synchronize` without `preview`                                   | `skip`    |
| `unlabeled` of `preview`                                          | `destroy` |
| `closed`, including merge                                         | `destroy` |
| `labeled` with `preview` after the pull request is closed         | `skip`    |

`CI` also listens to `closed` so in-progress jobs can cancel. `.github/workflows/cancel-ci-after-merge.yml` cancels CI after merge.

**Harness.** One GitHub trigger covering those six pull request actions. The pipeline's first step is `commandForPullRequest`. Later steps run only for `update` and `destroy`.

**Expected.**

- The six rows above produce the same command in Harness and in `node deploy/preview/controller.mjs decide`.
- A synchronize without the label does not delete an existing preview. This protects preview 20's history: a push must not destroy a preview that was not labeled for that event.
- Closing or merging runs destroy once.
- The Harness execution appears on the pull request as a commit status. Branch protection can require it.

**Actual.** not run.

### 12. Two previews at once

**Current.** `preview.yml` deploy concurrency group is per preview Devbox flow, and the build concurrency group is `preview-build-<hash>`. Isolation is Compose project `preview-<pr>`, volume names that include the pull request number, Neon branch `preview-pr-<pr>`, hostname `pr-<pr>`, and a Vercel variable scoped to that git branch.

**Harness.** Open two labeled pull requests. Let both pipelines run together. Then push to both.

**Expected.**

- Each hostname serves its own Dyad window.
- A row written in pull request 1's Neon branch is absent from pull request 2.
- A build for a shared context hash runs once. The two deploys still use different Compose projects.
- Canceling pull request 1's execution does not cancel pull request 2.
- Neither preview mounts `/opt/gascity` or the production Docker volume `weaver-plus_weaver-plus-user-data`.

**Actual.** not run.

### 13. Cleanup after merge or close

**Current.** `preview.yml` job `destroy` runs when `command` is `destroy`. It removes the preview Compose project, the Cloudflare record for `pr-<pr>.anakwannaphaschaiyong.com`, the Vercel Preview variable for that git branch, and the Neon child. Devbox `Wewebplus-ci` itself stays up. A Namespace session stop is a separate lifecycle: the public URL stops with the session, and files return when the Devbox starts again.

**Harness.** Close one of the two pull requests from experiment 12. Leave the other open.

**Expected.**

- The closed pull request's hostname, Neon branch, and Vercel Preview variable are gone.
- The open pull request's hostname, branch, and variable remain.
- The apex DNS record is unchanged.
- The Devbox VM still exists.
- A Harness "environment deleted" mark with the Neon branch still present is a fail.

**Actual.** not run.

### 14. Logs, status, diagnosis, and audit

**Current.** GitHub Actions stores one log per step, a job conclusion, and annotations. `gh run view <id> --log-failed` is the agent's path. Failed commands keep their exit code. Secret values are masked. Pull request checks show the workflow name. Audit of who re-ran a job is the GitHub Actions UI and the audit log.

**Harness.** For one forced failure in `fast-check` and one forced health-check failure, record the Harness execution URL, the step log, the status posted back to the commit, and the audit entry for who started the run.

**Expected.**

- An agent can retrieve the failed step log with a CLI or API call, without clicking through a tree of unrelated steps.
- The commit status on the pull request names the pipeline and links to that execution.
- The log redacts connection strings the same way `deploy/preview/neon.mjs` scrubs `postgres://`.
- The audit entry names the human or the trigger. A run that cannot be tied back to a commit SHA is a fail.
- Finding the failed command takes no more steps than `gh run view --log-failed`.

**Actual.** not scored. The failed step log for `nI911DyPQC2Gd1sIV6yQOw` was downloaded after polling `POST /gateway/log-service/blob/download` until `status` was `success`. The log contains `npm error Class extends value undefined is not a constructor or null`. The step node exposes that prefix as `logBaseKey`. Getting it takes the execution API, the log key, and a polled download, which is more than `gh run view --log-failed`. Commit status `dyad_fast_check-fast_check` on `3c9fb7c1` is success and links to execution `AZ8LJ5CLQSGY0QCbWG69_g`. The summary says the trigger type is `MANUAL` and a triggered-by identifier is present. Redaction is not checked: this log has no `postgres://` value. A forced health-check failure is not run.

### 15. An agent can operate the pipeline

**Current.** An agent edits `.github/workflows/*.yml` and the scripts under `deploy/preview/` and `scripts/gascity/`. It pushes, reads `gh run list` and `gh run view --log-failed`, and changes the script. The workflow YAML and the controller are the source of truth.

**Harness.** Give an agent a pipeline that fails experiment 2 on a one-line test assertion. The agent may read the execution log and edit the pipeline file in git. The agent may not be told which file to open. A second agent does the same for `ci.yml`.

**Expected.**

- The agent finds the failing command from the log, edits the git file, and reruns with a CLI or API call.
- The corrected pipeline is reviewable as a pull request diff.
- A fix that exists only as a Harness UI edit, or a pipeline export the agent cannot round-trip, is a fail.
- Compare the number of files the agent had to read. Harness replacing ten workflow files with one pipeline is a pass only when experiments 2, 4, 5, and 11 also pass. Fewer files that hide the Devbox and Neon steps are a fail.

**Actual.** not run.

## Substitution matrix

This is the decision the experiments are for. The **Until experiments pass** column is the only recommendation that is valid today.

| Piece                                                                                               | If the experiments pass                                                                                           | Until experiments pass                                | Stay outside Harness either way                                           |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `ci.yml` `fast-check`                                                                               | Harness replaces the required check after three matching pull requests                                            | GitHub Actions remains required                       | Node, Vitest, the test files                                              |
| `ci.yml` path filters and cancel-on-push                                                            | Harness trigger filters and concurrency                                                                           | GitHub Actions                                        |                                                                           |
| `ci-desktop.yml` Electron matrix                                                                    | Harness manual pipeline, still not required on this fork                                                          | GitHub Actions `workflow_dispatch`                    | macOS and Windows runners, which Harness must provide or the matrix stays |
| `gascity-image.yml` and `Dockerfile.gascity`                                                        | Harness runs the build and pushes GHCR                                                                            | GitHub Actions publishes the tags preview deploys     | GHCR, the Dockerfiles, the Gas City fork                                  |
| Context-hash reuse                                                                                  | Harness calls `preview-image-id.mjs`                                                                              | GitHub Actions `identify`                             | The hash script. Harness layer cache is extra, not the contract           |
| Doppler fetch                                                                                       | Harness OIDC identity per environment                                                                             | GitHub OIDC identities that already work              | Doppler. Secrets are not copied                                           |
| Preview label lifecycle                                                                             | Harness trigger plus `commandForPullRequest`                                                                      | `preview.yml`                                         | Devbox `Wewebplus-ci`, Compose, Cloudflare, Clerk                         |
| Neon child and Vercel Preview variable                                                              | Harness calls `neon.mjs` and `vercel.mjs`                                                                         | `preview.yml` deploy and destroy                      | Neon and Vercel                                                           |
| Two previews, and cleanup                                                                           | Harness, after experiments 12 and 13                                                                              | `preview.yml`                                         | The per-PR names. Harness environments do not replace them                |
| `gascity-rollout.yml`                                                                               | Harness calls `rollout.sh` on a non-production engine first. Production SSH moves only after experiment 10 passes | GitHub Actions and the host wrapper                   | The EC2 host, `compose.gascity.yml`, the previous-image tag               |
| ECS canary                                                                                          | Harness runs the canary pipeline after experiment 9 passes on cluster `wewebplus`                                 | The canary branch's own workflow, still not promotion | ECS, ECR, the security group, Doppler `dyad/canary`                       |
| Commit statuses                                                                                     | Harness posts the status GitHub branch protection requires                                                        | GitHub Actions checks                                 | GitHub remains the place a pull request is merged                         |
| CLA, Claude and Codex review, issue triage, stale-PR bots, security advisories, Playwright comments | Stay in GitHub Actions                                                                                            | Stay in GitHub Actions                                | `pull_request_target` and issue events. These are not deploy pipelines    |

## Migration order

The schedule for running these phases, including who acts and when to stop, is [plans/harness-experiment-run.md](harness-experiment-run.md).

Start the next phase only when the listed experiments pass. A failed experiment stops that phase.

1. **Mirror CI.** Run experiment 2 beside `ci.yml` for three pull requests. GitHub Actions stays the required check. Add experiment 14 on the first failure.
2. **Mirror image reuse.** Run experiments 1 and 4. Harness may push `harness-` tags. It may not retag `:preview` or replace `dyad:ctx-<hash>` until the digest check passes.
3. **Secrets and isolation.** Run experiments 5 and 6 before any deploy pipeline. A cross-environment read stops the migration.
4. **One preview.** Run experiments 3, 7, 8, 11, and 13 on a single labeled test pull request. Then run experiment 12 with a second pull request.
5. **Agent trial.** Run experiment 15 on the preview pipeline. Continue only if the agent can edit the git pipeline and rerun it.
6. **Rollback on a copy.** Run experiment 10 on a disposable Docker engine.
7. **Canary, without promotion.** Run experiment 9 against cluster `wewebplus`. Leave the apex on `gascity-server`.
8. **Production rollout last.** Point Harness at `gascity-rollout` only after steps 6 and 7 pass, and only for one commit, with `weaver-plus:gascity-previous` still on the host.

GitHub-native bots in the last row of the matrix are not in this order.

## Score sheet

Copy one row per experiment after the run. Leave `not run` rather than predicting a pass.

| #   | Experiment             | GitHub Actions run                                                                                                                                                                                                                                                                 | Harness execution                                                            | Actual                                   | Pass | Wall clock, GHA vs Harness                    | Cost | Gaps                                                                                                                               |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- | ---- | --------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Images                 |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 2   | Tests                  | [37637696349](https://github.com/Awannaphasch2016/dyad/actions/runs/37637696349) rules skip; [37637696754](https://github.com/Awannaphasch2016/dyad/actions/runs/37637696754) schema run; [37637701704](https://github.com/Awannaphasch2016/dyad/actions/runs/37637701704) src run | `v4k6khxBTx6MJ8wEfKF9Mg`, `FSjygwCbRpKfRLFtUG2N7Q`, `4zEFjfPrRLyXhoe5GgBrJg` | three pull requests matched skip and run | yes  | rules 13s/35s; schema 193s/230s; src 101s/99s |      | rules stage status is Success while its test steps are Skipped; no paired failing test; first webhook round cloned the base branch |
| 3   | Preview                |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 4   | Image reuse            |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 5   | Doppler                |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 6   | Isolation              |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 7   | Neon                   |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 8   | Connect containers     |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 9   | Canary                 |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 10  | Rollback               |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 11  | Pull request lifecycle |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 12  | Concurrent previews    |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 13  | Cleanup                |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
| 14  | Observability          | `gh run view --log-failed` is one command                                                                                                                                                                                                                                          | `nI911DyPQC2Gd1sIV6yQOw` log downloaded                                      | npm error retrieved, not scored          |      |                                               |      | more API calls than gh; redaction and health-check failure not checked                                                             |
| 15  | Agent                  |                                                                                                                                                                                                                                                                                    |                                                                              | not run                                  |      |                                               |      |                                                                                                                                    |
