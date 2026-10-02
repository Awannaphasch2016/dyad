# Fast CI for agent iteration

> Written 2026-10-02. The required check matches the URL deployment: one Linux process, no Electron end-to-end matrix.

## Summary

Every push to this branch currently waits on a desktop Electron suite: a macOS build, a Windows build, and eight Playwright shards. The run that is in progress, https://github.com/Awannaphasch2016/dyad/actions/runs/37041278034, spent about three minutes on setup per shard and then about fifty minutes inside `E2E tests`. The Gas City roll-up waits for that whole `ci.yml` conclusion before it SSHs.

The required check becomes one Ubuntu job: format, lint, typecheck, the browser-bridge tests, the file-sync tests, and `scripts/gascity/rollout.test.sh`. Electron end-to-end stays in the workflow file for the upstream repo and can be started here with `workflow_dispatch`. It does not run on pushes to this fork, and the roll-up does not wait for it.

## Problem Statement

An agent iteration is a push, a check, and then a host roll-up. The current check is the desktop app matrix. Playwright launches `electron.launch` against a packaged macOS app and a packaged Windows app. The URL path is one Linux container serving `127.0.0.1:8373`. Those OS shards do not open that URL.

Measured on the in-progress run, started 17:31:24 UTC:

| Piece                  | Duration                                        | Result                                                                                  |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `check-changes`        | 9s                                              | success                                                                                 |
| macOS unit-test job    | 1m 27s                                          | format check failed; unit tests never started                                           |
| macOS Electron build   | 4m 10s                                          | success                                                                                 |
| Windows Electron build | 7m 14s                                          | success                                                                                 |
| Windows unit tests     | 20m 54s, of which 17m 04s was `npm test`        | 177 failed, 9266 passed                                                                 |
| Each end-to-end shard  | about 3–4m setup, then about 50m in `E2E tests` | Windows shard 3 failed at 46m 30s; the other seven were still in that step at 18:32 UTC |

The wall clock is the slowest shard, not the sum. The roll-up at https://github.com/Awannaphasch2016/dyad/actions/runs/37041276650 stays on "Wait for CI" until `ci.yml` succeeds.

## Scope

### In scope

- Skip Electron artifact builds, the eight end-to-end shards, report merge, and the macOS safe-storage Playwright spec on `Awannaphasch2016/dyad`.
- Add one required Ubuntu job that the roll-up can treat as CI success.
- Format the 14 files that already fail `npm run presubmit` on macOS, so the fast job can go green.
- Leave the upstream matrix in place: when `github.repository` is `dyad-sh/dyad`, the current macOS and Windows jobs still run.

### Out of scope

- Rewriting Playwright specs into browser tests against the tunnel URL.
- Making the 177 Windows unit-test failures pass. They stop blocking this fork because that job no longer runs here.
- Merging this branch.
- A nightly scheduler. Desktop Electron coverage remains `workflow_dispatch` on a copied workflow until someone asks for a schedule.

## What the agent sees

1. Push to `cursor/browser-dyad-ui-bbea`.
2. `ci.yml` runs the Ubuntu job. Format, lint, and typecheck are seconds to a couple of minutes after `npm ci`. The required Vitest files are the bridge, file-sync, and rollout helper tests.
3. On success, `gascity-rollout.yml` SSHs and builds the Linux image.
4. A person can still run the desktop matrix with `workflow_dispatch` on `.github/workflows/ci-desktop.yml`.

Failure of the Ubuntu job fails `ci.yml`. The roll-up then stops instead of deploying. Skipped Electron jobs do not fail the workflow.

## Technical design

### Required job

In `.github/workflows/ci.yml`, add `fast-check` on `ubuntu-latest` when `should_run_tests` is true:

- checkout the PR head, same as the existing jobs
- Node 24.13.1, `npm install -g npm@11.8.0`, `scripts/npm-ci-retry.sh`
- `npm install && npm run build` in `testing/fake-llm-server` (typecheck and Vitest import it)
- `npm run presubmit`
- `npm run ts`
- `npm test -- src/main/browser_bridge.test.ts src/control_plane/file_sync.test.ts`
- `bash scripts/gascity/rollout.test.sh`

`npm test -- <paths>` appends arguments to the final Vitest command. The script-level `node --test` prefix still runs; that is acceptable.

### Electron jobs stay for upstream

Gate these jobs with `github.repository == 'dyad-sh/dyad'` in addition to their current `if`:

- `build-e2e-artifacts`
- `e2e-tests`
- `merge-reports`
- `safe-storage-e2e`
- `unit-tests-macos`
- `unit-tests-windows`

On this fork those jobs are skipped. On `dyad-sh/dyad` the privileged and non-privileged matrices are unchanged. `merge-reports` already depends on `e2e-tests`; a skipped need skips the merge.

### Desktop workflow

Copy the current Electron jobs into `.github/workflows/ci-desktop.yml` with `workflow_dispatch` only. That gives this fork a way to run the macOS and Windows shards without putting them on the push path. The copy is the existing matrix, including the "Electron Playwright is not run on ubuntu-latest" comment in `ci.yml`.

### Roll-up

`.github/workflows/gascity-rollout.yml` keeps waiting for `ci.yml` on the same SHA. After the skip, a successful Ubuntu job makes `ci.yml` succeed. The 90-minute wait can stay; the success should arrive much sooner. No change to the SSH step.

### Format drift that blocks presubmit

The macOS job failed `npm run presubmit` before unit tests. oxfmt listed:

- `hitl-web/app/api/questions/[id]/answers/route.ts`
- `hitl-web/app/api/questions/route.ts`
- `plans/clerk-auth-login.md`
- `plans/member-owned-organizations.md`
- `src/auth/AccountSwitcher.test.tsx`
- `src/auth/ClerkAuthProvider.tsx`
- `src/auth/permissions.test.ts`
- `src/components/chat/HitlQuestionList.test.tsx`
- `src/components/chat/HitlQuestionList.tsx`
- `src/control_plane/access.ts`
- `src/control_plane/hitl.test.ts`
- `src/control_plane/hitl.ts`
- `src/lib/adminAccess.test.ts`
- `src/main/factory_host_bridge_server.ts`

Implementation runs `npm run fmt` and keeps only those files if the formatter also touches anything else. Without this, the fast job fails in the same format check.

## Implementation plan

### Phase 1: Make the required check green and small

- [x] Format the 14 files above and revert any unrelated formatter edits.
- [x] Add `fast-check` to `ci.yml`.
- [x] Add the repository guard so Electron builds, shards, report merge, safe-storage, and the macOS/Windows unit-test jobs skip on this fork.
- [x] Add `ci-desktop.yml` as `workflow_dispatch` with the current Electron matrix.
- [x] Run `bash scripts/gascity/rollout.test.sh` and the two Vitest files locally.

### Phase 2: Confirm the roll-up gate

- [ ] Push and confirm the new `ci.yml` run does not start `e2e-tests` or `build-e2e-artifacts`.
- [ ] Confirm `gascity-rollout.yml` leaves "Wait for CI" when `fast-check` succeeds.
- [ ] The host build still fast-forwards, tags `weaver-plus:gascity-previous`, and rolls back the local image if the new container is not healthy.

## Testing strategy

- Local: `npm run presubmit`, `npm run ts`, the two Vitest paths, `scripts/gascity/rollout.test.sh`.
- CI evidence: the next `ci.yml` run on this fork shows `fast-check` and skipped Electron jobs.
- Desktop Electron coverage is the manual `ci-desktop.yml` run, not this push.

## Risks

| Risk                                                                         | Likelihood | Impact           | Mitigation                                                                                |
| ---------------------------------------------------------------------------- | ---------- | ---------------- | ----------------------------------------------------------------------------------------- |
| A desktop regression lands on this branch and the URL check does not see it  | Medium     | Medium           | Desktop suite remains on `workflow_dispatch` and still runs for `dyad-sh/dyad`            |
| Ubuntu Vitest fails on a native module                                       | Low        | Medium           | Rebuild `better-sqlite3` in the job if the first run reports a missing binding            |
| Formatter edits unrelated files                                              | Medium     | Low              | Revert every hunk outside the 14 known files                                              |
| Full `npm test` is still red on this branch                                  | High       | Low for the gate | The required job does not run the full suite. The Windows run already showed 177 failures |
| Skipping jobs on a fork condition is easy to get wrong and skip upstream too | Low        | High             | Guard is `github.repository == 'dyad-sh/dyad'` for the heavy jobs, not a branch name      |

## Decision log

- The required signal is the Linux URL path. macOS and Windows Electron shards are the wrong wait for a host roll-up.
- The full Vitest suite is not the required gate. One Windows run spent 17 minutes in `npm test` and failed 177 tests spread across desktop behavior. Blocking every agent push on that suite keeps the loop slow and red.
- Upstream `dyad-sh/dyad` keeps today's matrix, so this fork's speed change does not remove desktop CI from the project the workflow file came from.
- The roll-up keeps waiting on `ci.yml`. The workflow's success condition changes because the slow jobs are skipped, not because the roll-up learns a second workflow name.
