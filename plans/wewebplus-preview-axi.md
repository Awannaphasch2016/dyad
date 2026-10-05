# Implement the Wewebplus preview CLI as an AXI

> Written 2026-10-05. Agents currently wake and inspect previews by reading workflow YAML and shell scripts. The CLI is the control plane. The scripts stay the implementation.

## Summary

Add `wewebplus-preview`, a command built on `axi-sdk-js`, following the [AXI specification](https://github.com/kunchenguid/axi/blob/main/.agents/skills/axi/SKILL.md) and the `gh-axi` command shape. `runAxiCli` owns TOON output, `--help`, the version fast path, exit codes, and the reserved `update` command. Handlers return plain objects.

The binary name is `wewebplus-preview`. There is no separate `create` command. The first `deploy` creates a preview. A later `deploy` of the same digest is a no-op.

Agents do not choose a script, a workflow file, or a transport. `transport.js` uses `devbox exec` when that command can reach `Wewebplus-ci`, and otherwise dispatches `preview-control.yml`. `resume` never falls through to an image build.

## Problem

A preview is Compose project `preview-<pr>` on Devbox `Wewebplus-ci`, at `https://pr-<pr>.anakwannaphaschaiyong.com`. The image tag is `ghcr.io/awannaphasch2016/dyad:sha-<commit>`. `preview-up.sh` accepts only the digest form. Saved state is `$HOME/.local/state/wewebplus-preview/preview-<pr>.env` on the Devbox. The production marker `/opt/gascity/weaver-plus` refuses the scripts.

Two workflows deploy that machine. Preview image builds a missing SHA tag, then resumes every saved preview and updates the open PR for the branch. Preview does the label and close paths for other PRs. The Devbox command always runs `preview-resume.sh <pr>` first. That argument is the PR to skip, not the PR to start. `PREVIEW_SKIP_TUNNEL=1` is always set, and `preview-up.sh` still creates a named tunnel when `CLOUDFLARE_API_TOKEN` is set. `assign-page` in Preview image hardcodes git branch `cursor/dyad-web-frontend-bbea`.

Namespace login exists only inside a GitHub Actions job, via `nsc auth exchange-github-token`. This agent cannot dispatch or rerun workflows (HTTP 403) and cannot `devbox exec` (gateway 403). An empty commit is already rejected by `.husky/pre-push`. The CLI must not invent a third wake path.

## Scope

### In scope

- `deploy/preview/cli/` using `axi-sdk-js` and `@toon-format/toon`.
- Commands: home, `status`, `inspect`, `verify`, `logs`, `resume`, `deploy`, `destroy`, `db`, `env`, `run`, `setup`.
- `.github/workflows/preview-control.yml`, `workflow_dispatch` only. Inputs: `action` (`resume`, `deploy`, `destroy`, `status`, `logs`) and `pr`. The job exchanges the GitHub token and runs one existing script. It does not build an image.
- One `preview_result` line from `preview-up.sh` and `preview-resume.sh`: `pr`, `action`, `url`, `http`, `bridge`, `tunnel`, `gc`.
- Pass the PR head branch into `assign-page` instead of `cursor/dyad-web-frontend-bbea`.
- Unit tests and PATH-fake integration tests. A skill generated from the home help, with a stale-skill check.

### Out of scope

- Rewriting `preview-up.sh`, `preview-resume.sh`, `preview-tunnel.mjs`, `controller.mjs`, `neon.mjs`, `vercel.mjs`, `render.mjs`, or `clerk-origins-run.mjs`.
- A new Namespace API token.
- Printing or copying secret values.
- Closing or merging PR 20 or PR 27.
- Changing the production host, `/opt/gascity`, or `gascity-rollout`.
- Playwright coverage of the formula canvas.

## Command map

| Command | Calls | CLI adds |
| --- | --- | --- |
| home, `status` | Public URL plus the latest Preview image run. After the control workflow exists, its `preview_result` line | Four fields: `pr`, `url`, `http`, `bridge` |
| `inspect --pr` | Same sources | Digest, tunnel kind, gc, Neon branch name, Clerk origin, transport |
| `verify --pr` | HTTP GET | Exit 0 only for HTTP 200 and `data-dyad-browser-bridge` |
| `logs --pr` | `docker logs` on the Devbox for `preview-<pr>-<service>-1` | Tail of 2,000 characters. `--full` writes a temp file |
| `resume` | `preview-resume.sh` | Starts the requested PR, or every saved PR when `--pr` is omitted. Does not pass the skip argument |
| `deploy` | Tag inspect, then `controller.mjs attach` and `preview-up.sh` | Skips the image build when `sha-<commit>` already exists |
| `destroy --pr --yes` | `controller.mjs destroy`, then Compose `down`, then delete the three state files | Refuses an inferred PR, a missing `--yes`, and the production marker |
| `db status\|ensure\|assign` | `neon.mjs`, `vercel.mjs` | `assign` uses the PR head branch unless `--git-branch` is set |
| `env status` | Key names from `render.mjs` | `present` or `absent` only |
| `run list\|view` | `gh run list` and `gh run view` for the preview workflows | Same shape as `gh-axi run` |
| `setup hooks` | `installSessionStartHooks` | Opt-in. Idempotent |

`deploy` of a PR with no env file creates the Neon branch, tunnel, Compose project, and Clerk origin. `deploy` of the same digest with the page already up exits 0 as `already_current`. `resume` of a running preview exits 0 as `already_running`. `destroy` of a missing preview exits 0 as `already_absent`. `db ensure` keeps `ensurePreviewBranch`.

## Design

### Layout

```
deploy/preview/cli/
  bin.js
  version.js
  cli.js
  context.js
  transport.js
  commands/
```

`bin.js` imports `tryFastPath` from `axi-sdk-js/fast-path` and `VERSION` from `version.js`. The command graph loads only when the fast path returns false. `version.js` imports node builtins only.

`cli.js` calls `runAxiCli` with a one-sentence description, `topLevelHelp`, `resolveContext`, `home`, and `commands`. Unknown flags are rejected in the subcommand before any script or network call. Flags before the command are a usage error, which the SDK already enforces.

### Context

Resolution order for the PR: `--pr`, then `PREVIEW_PR`, then the single open PR whose head is the current branch. Zero matches or more than one match exits 2 and lists the candidates. The repo comes from `git remote get-url origin`, overridable with `--repo`. `destroy` ignores the inferred PR. Both `--pr` and `--yes` are required.

### Transport

`transport.js` tries `devbox exec Wewebplus-ci -- echo ok` only when `GITHUB_ACTIONS=true` or a Namespace token file is already configured. Otherwise it uses `gh workflow run preview-control.yml`. A 403 from either path is `transport: unavailable` on stdout, exit 1, with the last successful Preview image run URL and the **Re-run all jobs** action. `resume` does not dispatch Preview image.

The control workflow holds the existing `preview-devbox-wewebplus-ci` concurrency group so it cannot overlap a deploy.

### Output and errors

Stdout is TOON. Stderr is progress. Exit 0 is success, including no-ops. Exit 1 is an operation that could not be completed. Exit 2 is usage, including unknown flags. Errors use `AxiError` and include the repairing command. Suggestions appear on list and mutation output. `verify` and `inspect` omit them.

Home after a 530 and a published image suggests `wewebplus-preview resume --pr <pr>`. Home after a missing image suggests `wewebplus-preview deploy`. An empty saved-preview list prints `previews: 0 saved on Wewebplus-ci`.

Log bodies truncate to the last 2,000 characters and include the total size. The `--full` hint is present only when truncation happened.

### Credentials and guards

The CLI never reads or prints a secret value. `env status` reports presence for `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `NEON_API_KEY`, and `CLERK_SECRET_KEY`.

`destroy` refuses when `/opt/gascity/weaver-plus` exists. `resume` does not stop other previews. A low-memory or low-disk result from the scripts is `left_stopped` with the script's reason.

`tunnel` in status is `named`, `quick`, or `absent`, derived from the env file and whether the Cloudflare API token is present. The CLI does not describe `PREVIEW_SKIP_TUNNEL` as the behavior.

### Ambient context

`setup hooks` installs the SDK session hook for Claude Code, Codex, and OpenCode at project scope. It does not run from any other command. A skill at `.agents/skills/wewebplus-preview/SKILL.md` is generated from the home help with live rows removed, and a test fails when the committed skill differs. Cursor cloud agents load the skill. They do not receive those session hooks.

### Phases

1. CLI skeleton, home, `status`, `verify`, and `run`, using the public URL and `gh`. No Devbox changes.
2. `preview-control.yml`, the `preview_result` line, `resume`, `logs`, and `destroy`.
3. `deploy` and `db`, including the `assign-page` branch fix.
4. `env status`, `setup hooks`, and the skill check.

## Verification

Unit tests in `node --test` cover PR inference, unknown flags, `destroy` without `--yes`, secret redaction, no-op result mapping, and the home TOON shape. They do not open a network connection.

Integration tests put fake `gh`, `devbox`, and `docker` on `PATH`. `resume` must not call the image build. `deploy` of an existing tag must not call the image build. Stdout must not contain `nsrt_`, `dp.st.`, or a `CLOUDFLARE_TUNNEL_TOKEN=` value.

`--version` is measured against `node -e "console.log(1)"` in the same process, using the axi-sdk fast-path pattern.

A live `workflow_dispatch` of the control workflow for PR 27 is a manual check. It is not part of `npm test`. Success is `wewebplus-preview verify --pr 27` exiting 0, with PR 20 left running.

## Agent session

```
wewebplus-preview
wewebplus-preview resume --pr 27
wewebplus-preview verify --pr 27
```

Home shows `http: 530` and `image: published`, so the next command is `resume`. `verify` exits 0 when the page contains the browser bridge.

```
wewebplus-preview deploy
wewebplus-preview verify
```

`deploy` publishes only when the SHA tag is missing. A second `deploy` of that SHA prints `already_current` and exits 0.

```
wewebplus-preview destroy --pr 29 --yes
```

PR 20 and PR 27 stay up. A second destroy prints `already_absent` and exits 0.
