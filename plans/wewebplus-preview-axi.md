# Implement the Wewebplus preview CLI as an AXI

> Written 2026-10-05. The CLI is the control plane. The scripts stay the implementation.

## Important points

- Binary: `wewebplus-preview`, built on `axi-sdk-js`.
- No `create` command. First `deploy` creates. Same digest again exits 0 as `already_current`.
- `resume` starts containers that are already built. It never builds an image.
- The agent does not pick a script, a workflow, or a transport.
- Transport is `devbox exec` when that reaches `Wewebplus-ci`. Otherwise dispatch `preview-control.yml`.
- A 403 stays an error that points at **Re-run all jobs**. No empty commit. No new Namespace token.
- Secrets are reported as `present` or `absent`. Values are never printed.
- `destroy` requires `--pr` and `--yes`. It refuses the production marker.
- Four build phases. Live dispatch for PR 27 is a manual check, not `npm test`.

## What is wrong today

- Preview identity is `preview-<pr>` on Devbox `Wewebplus-ci`, URL `https://pr-<pr>.anakwannaphaschaiyong.com`.
- Image tag is `ghcr.io/awannaphasch2016/dyad:sha-<commit>`. `preview-up.sh` accepts only the digest.
- State file on the Devbox: `$HOME/.local/state/wewebplus-preview/preview-<pr>.env`.
- Production marker `/opt/gascity/weaver-plus` refuses the scripts.
- `preview-resume.sh <pr>` means "skip this PR", not "start this PR".
- `PREVIEW_SKIP_TUNNEL=1` is always set, and a named tunnel is still created when the Cloudflare token is present.
- `assign-page` hardcodes git branch `cursor/dyad-web-frontend-bbea`.
- Namespace login exists only inside GitHub Actions (`nsc auth exchange-github-token`).
- This agent gets HTTP 403 on dispatch, rerun, and `devbox exec`.
- `.husky/pre-push` already rejects an empty commit.

## In scope

- `deploy/preview/cli/` on `axi-sdk-js`.
- Commands: home, `status`, `inspect`, `verify`, `logs`, `resume`, `deploy`, `destroy`, `db`, `env`, `run`, `setup`.
- `preview-control.yml`, manual run only. Actions: `resume`, `deploy`, `destroy`, `status`, `logs`. No image build.
- One `preview_result` line from the two shell scripts: `pr`, `action`, `url`, `http`, `bridge`, `tunnel`, `gc`.
- `assign-page` uses the PR head branch.
- Unit tests, PATH-fake integration tests, and a skill that fails CI when it drifts.

## Out of scope

- Rewriting the existing preview scripts.
- A new Namespace API token.
- Printing secret values.
- Closing or merging PR 20 or PR 27.
- Production host, `/opt/gascity`, or `gascity-rollout`.
- Playwright coverage of the formula canvas.

## Commands

- home, `status` — public URL and the latest run. Fields: `pr`, `url`, `http`, `bridge`.
- `inspect --pr` — adds digest, tunnel, gc, Neon branch, Clerk origin, transport.
- `verify --pr` — exit 0 only for HTTP 200 and `data-dyad-browser-bridge`.
- `logs --pr` — last 2,000 characters. `--full` writes a temp file.
- `resume` — start the given PR, or every saved PR when `--pr` is omitted.
- `deploy` — build the image only when `sha-<commit>` is missing, then `preview-up.sh`.
- `destroy --pr --yes` — remove that preview. Refuses an inferred PR.
- `db status|ensure|assign` — Neon branch and the Vercel variable. `assign` uses the PR head branch.
- `env status` — key names only.
- `run list|view` — preview workflow runs, same shape as `gh-axi run`.
- `setup hooks` — opt-in session hook. Idempotent.

## No-ops

- `deploy` of the same digest with the page up: `already_current`, exit 0.
- `resume` of a preview that is already up: `already_running`, exit 0.
- `destroy` of a preview that is already gone: `already_absent`, exit 0.
- `db ensure` keeps the existing `ensurePreviewBranch` behavior.

## Rules

- PR resolution: `--pr`, then `PREVIEW_PR`, then the one open PR for the current branch.
- Zero or several PRs: exit 2 and list them.
- Repo: `git remote get-url origin`, or `--repo`.
- Stdout is TOON. Stderr is progress.
- Exit 0 success, including no-ops. Exit 1 operation failed. Exit 2 usage.
- Unknown flags fail before any script or network call.
- Suggestions on lists and mutations. None on `verify` or `inspect`.
- HTTP 530 and a published image suggests `resume`. A missing image suggests `deploy`.
- Empty list prints `previews: 0 saved on Wewebplus-ci`.
- Tunnel status is `named`, `quick`, or `absent`.
- `resume` does not stop other previews.
- Low memory or low disk is `left_stopped`. Other previews stay up.
- `setup hooks` targets Claude Code, Codex, and OpenCode. Cursor cloud agents use the skill instead.

## Phases

1. Skeleton, home, `status`, `verify`, `run`. Public URL and `gh` only.
2. Control workflow, `preview_result`, `resume`, `logs`, `destroy`.
3. `deploy` and `db`, including the branch fix.
4. `env status`, `setup hooks`, skill check.

## Tests

- Unit: PR inference, unknown flags, `destroy` without `--yes`, secret redaction, no-op mapping, home TOON shape. No network.
- Integration: fake `gh`, `devbox`, and `docker` on `PATH`. `resume` and `deploy` of an existing tag must not build an image. Stdout must not contain `nsrt_`, `dp.st.`, or a tunnel token value.
- `--version` stays on the axi-sdk fast path.
- Manual only: dispatch the control workflow for PR 27. `verify --pr 27` exits 0. PR 20 stays up.

## Agent session

Wake a preview that is already built:

- `wewebplus-preview`
- `wewebplus-preview resume --pr 27`
- `wewebplus-preview verify --pr 27`

Ship a new commit:

- `wewebplus-preview deploy`
- `wewebplus-preview verify`

Remove one preview:

- `wewebplus-preview destroy --pr 29 --yes`
