# Run the Harness experiments in order

This is the schedule for [plans/harness-equivalence.md](harness-equivalence.md). Run one phase, score it, then start the next phase only if that phase passed. The score sheet in the equivalence plan stays the record. This file says what to do next.

Passing a phase is what allows Harness to take over that workflow. GitHub remains the place a pull request is merged. CLA, Claude and Codex review, issue triage, stale-PR bots, security advisories, and Playwright comments stay in GitHub Actions.

## Where this stands

| Phase                         | Experiments              | Standing                                                                            |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| 1. Mirror CI                  | 2                        | Pass. GitHub Actions is still the required check.                                   |
| Logs                          | 14                       | Started, not scored. Does not block phase 2. Must be scored before the set is done. |
| 2. Mirror image reuse         | 1, 4                     | In progress. The classic token pushed a scratch layer. The Harness image build is starting. |
| 3. Secrets and isolation      | 5, 6                     | Not run. Required before any preview deploy.                                        |
| 4. One preview, then a second | 3, 7, 8, 11, 13, then 12 | Not run.                                                                            |
| 5. Agent trial                | 15                       | Not run.                                                                            |
| 6. Rollback on a copy         | 10                       | Not run.                                                                            |
| 7. Canary, without promotion  | 9                        | Not run.                                                                            |
| 8. Production rollout         | production host          | Not run. Last.                                                                      |

## Rules for every phase

- Write the Actual paragraph and the score row before marking a pass. A failed experiment stops that phase.
- Record wall clock from the two runs. Leave Cost blank until a Harness bill is read.
- Store each pipeline in `deploy/harness/`. Register it with a one-shot GitHub Actions workflow that uses `HARNESS_API_KEY`, then delete that workflow when the phase no longer needs it.
- Do not print a private key, API token, Doppler token, or signed log URL.
- Do not copy secrets into Doppler configs `dyad/preview`, `dyad/canary`, `dyad/prd`, or `aws/dev`.
- Do not SSH to `13.251.216.187`. Do not change the apex DNS record for `anakwannaphaschaiyong.com`.
- This schedule does not change branch protection. Switching a required check is a separate step after that experiment's row says pass.
- The Electron matrix stays out unless it is explicitly requested.

## Human steps still open

These do not block phase 2.

1. On the GitHub App `dyad-harness`, delete the older private keys that were copied or screenshotted. Keep the key that already connected.
2. Delete the GitHub repository secret `DYAD_HARNESS_APP_PEM`. Leave `HARNESS_API_KEY` and `DOPPLER_ADMIN_TOKEN`.
3. Delete `DOPPLER_ADMIN_TOKEN` only after phase 3 has created the Harness OIDC identities and a Doppler login test has succeeded.

## Phase 2. Images

Experiments 1 and 4. This is the next run.

1. Add one Harness pipeline with two stages. Stage A checks out `Awannaphasch2016/gascity` and runs the same `go build`, `Dockerfile.base`, and `Dockerfile.agent` build as `.github/workflows/gascity-image.yml`. Stage B checks out this repo and runs `docker build` on `Dockerfile.gascity`.
2. Push only these tags: `ghcr.io/awannaphasch2016/gascity-base:harness-<sha>`, `ghcr.io/awannaphasch2016/gascity:harness-<sha>`, `ghcr.io/awannaphasch2016/dyad:harness-<sha>`, and `ghcr.io/awannaphasch2016/dyad:harness-ctx-<hash>`. Do not push `:preview`, `:sha-<commit>`, or `dyad:ctx-<hash>`. Do not push to ECR. Do not SSH.
3. Build the same commits with GitHub Actions using those same `harness-` tags. Do not dispatch `gascity-image.yml` as it is written, because that workflow also pushes `:preview`.
4. Score experiment 1 when `gc version` matches and the image config matches for entrypoint, user, exposed ports, environment, and the health pair: `GET /vnc.html` succeeds and unauthenticated `GET /v1/apps/0/factory-state` returns 401. A different layer byte with the same config contract can pass. A different entrypoint, user, or health check fails the phase.
5. Score experiment 4 with two commits that do not change the Docker context. Harness calls `node scripts/gascity/preview-image-id.mjs`, points both `harness-<commit>` tags at one digest, and skips `docker build`. A third commit that changes `Dockerfile.gascity` or a file the script includes must produce a new digest. A cache hit that still runs `docker build` for an unchanged context fails the phase.
6. Update the score rows. Stop if either experiment fails.

## Phase 3. Doppler

Experiments 5 and 6. Start only after phase 2 passes. No preview deploy before this phase passes.

1. Create four Doppler service-account identities. The issuer is `https://app.harness.io/ng/api/oidc/account/WKxXBnSFTRaOF64-h90PyQ`. Claims are exact: audience, pipeline identifier, and environment. A wildcard subject fails the phase even if the fetch succeeds.
2. Bind them separately: preview reads `dyad/preview`, canary reads `dyad/canary`, production reads `dyad/prd` from the production pipeline only, and the fourth identity is the dev read. No shared Harness secret and no shared service account. Leave the existing GitHub OIDC identities in place, including production identity `5a844bf1-8def-47f4-8ae1-9520f7bf109b`.
3. From the Harness execution, request a custom OIDC token at `POST https://app.harness.io/ng/api/oidc/id-token/custom`, exchange it at `POST https://api.doppler.com/v3/auth/oidc`, and print only the database host label.
4. Show that preview cannot read canary or production, canary cannot read production, and production cannot read preview. The canary pipeline must refuse to start when its database host equals the production host.
5. The log may show `db_endpoint=`. It must not show `postgres://` or a Doppler token. Harness secret manager must not contain `WEWEBPLUS_DATABASE_URL`, a Clerk secret, or a Cloudflare token after the run.
6. A cross-environment read stops the migration. After the login test succeeds, tell the user they may delete `DOPPLER_ADMIN_TOKEN`.

## Phase 4. One preview, then a second

Experiments 3, 7, 8, 11, and 13, then experiment 12. Start only after phase 3 passes.

Use two throwaway pull requests. Each gets the `preview` label, a Devbox project `preview-<pr>`, hostname `https://pr-<pr>.anakwannaphaschaiyong.com`, a Neon branch `preview-pr-<pr>`, and a Vercel Preview variable for that git branch only. Do not put the `preview` label on the experiment 2 probe pull requests.

1. On the first pull request, register a Harness trigger for Open, Synchronize, Reopen, Close, Label, and Unlabel. The first step runs `node deploy/preview/controller.mjs decide`. Later steps run only for `update` and `destroy`.
2. Experiment 3 passes when the log contains the same `command=update` line as GitHub Actions, port 32100 is not public, and the apex still serves the current production window.
3. Experiment 7 passes when that pull request has its own Neon child and its own Vercel Preview variable, the Vercel Production `WEWEBPLUS_DATABASE_URL` is unchanged, and an answer written there is absent from production.
4. Experiment 8 passes when a call inside the Compose network reaches Dyad at `http://dyad:32100`, an outside TCP connection to 32100 fails, and the public hostname returns the Dyad window. A Harness Kubernetes Service named `dyad` fails this experiment.
5. Experiment 11 passes when the six `commandForPullRequest` rows match `deploy/preview/transition.mjs`: label means update, synchronize without the label means skip, unlabel and close mean destroy, and labeling a closed pull request means skip. A synchronize without the label must not destroy an existing preview.
6. Open the second labeled pull request and run both pipelines together. Experiment 12 passes when each hostname and Neon branch is separate, a shared context hash builds once, and canceling one execution leaves the other running.
7. Close the first pull request and leave the second open. Experiment 13 passes when the closed hostname, Neon branch, and Vercel Preview variable are gone, the open ones remain, the apex DNS record is unchanged, and the Devbox VM still exists.
8. Stop the phase on the first failure. Do not start the agent trial.

## Phase 5. Agent trial

Experiment 15. Start only after phase 4 passes.

1. Put a one-line failing assertion in the preview pipeline in git and start a run. Do not tell the agent which file to open.
2. The agent must find the failing command from the execution log, edit the git file, and rerun with the CLI or API.
3. The fix must be a pull request diff. A change that exists only in the Harness UI fails the experiment.
4. Continue to phase 6 only if that rerun succeeds. Fewer pipeline files is a pass only when experiments 2, 4, 5, and 11 have also passed, and the Devbox and Neon steps are still visible.

## Phase 6. Rollback on a copy

Experiment 10. Start only after phase 5 passes.

1. Run `scripts/gascity/rollout.sh` on a disposable Docker engine. Start from a known-good image, then deploy a Dockerfile whose health check never passes.
2. Do not point this pipeline at `13.251.216.187` or `gascity-server`.
3. The experiment passes when the bad container is not left healthy, the running container is the previous image, the Harness execution is failed, and a second writer is not left running. If Harness can only roll back a Kubernetes revision and cannot restore `weaver-plus:gascity-previous`, the experiment fails.

## Phase 7. Canary, without promotion

Experiment 9. Start only after phase 6 passes.

1. Deploy one ECS task on cluster `wewebplus` with shared memory 1024. Run the health pair from `plans/pre-promotion-verification.md`.
2. Leave the promotion stage unexecuted. The apex stays on `gascity-server`.
3. The experiment passes when a healthy canary leaves the apex on the current production window, a failed health check does not start promotion, and the log says promotion was not performed.

## Phase 8. Production rollout

Start only after experiments 9 and 10 have passed.

1. Point Harness at `gascity-rollout` for one commit.
2. `weaver-plus:gascity-previous` must still be on the host before that run starts.
3. Score that single run in the equivalence plan. This schedule does not repeat production.

## Finish experiment 14

The first fast-check failure already opened this experiment. Finish it in any phase after phase 1, and score it before calling the set done.

1. Force one fast-check failure and one health-check failure.
2. Record the execution URL, the step log, the commit status, and the audit entry that names who started the run.
3. Show that a `postgres://` value is redacted the same way `deploy/preview/neon.mjs` scrubs it.
4. It passes only when retrieving the failed command takes no more steps than `gh run view --log-failed`. The current download path is more steps, so this row stays open until that changes or the gap is accepted as a fail.

## After each phase

Update the Actual text and the score row in `plans/harness-equivalence.md`, and update the pull request that carries that plan. Delete one-shot workflows that are no longer needed.

The set is done when every row from 1 through 15 has a pass or a recorded fail that stopped its phase. Harness then replaces only the workflows whose rows passed. The bots listed at the top stay in GitHub Actions.
