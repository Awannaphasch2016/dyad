# ops-axi

The operations AXI for this repository. It turns the workflows that run this fork's infrastructure into commands an agent or a person can call from a shell, and reads back the facts each workflow prints.

```sh
ops-axi ec2 check
ops-axi formula role
ops-axi formula verify
ops-axi formula deploy
ops-axi rollout 5e952bbc
ops-axi run preview-wake.yml --ref cursor/preview-wake-34-bbea --field name=value
```

It needs `gh` on the PATH and an authenticated token (`GH_TOKEN` or `gh auth login`). It carries no credentials and no AWS or Doppler access of its own; everything happens inside GitHub Actions, and `ops-axi` only starts runs and reads their logs.

## What a command does

1. `gh workflow run <file> --ref <branch>` with the operation's inputs.
2. Wait for the run that the dispatch created, then `gh run watch` it.
3. Read the run log and keep the `key=value` lines the workflow printed (its result lines).
4. Compare those lines against the operation's expectations. `formula verify` fails if `AWS_PREVIEW_FORMULA_ROLE_ARN=present` is missing even when the workflow itself passed; `formula deploy` fails without a `url=https://…` line.
5. Print a short block: the run (operation, workflow, ref, mode, id, url, conclusion), the result lines, and anything that failed verification.

Exit codes: `0` run passed and verification held, `1` run failed or verification failed, `2` usage error, `3` `gh` error (not installed, not authenticated, forbidden, workflow not found).

## When GitHub refuses to dispatch

GitHub only dispatches a workflow file that exists on the repository's default branch. A refused dispatch fails the command with `code: DISPATCH_REFUSED`. The command does not rerun an older run, because that rerun would ignore the arguments from this call.

## Doppler project and config

Every command accepts `--project` and `--config`. A command that reads a second config also accepts `--aws-project` and `--aws-config`. The default is the pair that command uses today. The workflow prints `project=` and `config=` before it reads secrets. `formula role` and `preview secrets` write a config and have no default, so they exit before calling `gh` when those flags are omitted.

## Secrets

Result lines whose key looks like a secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `ARN`) are printed as `<redacted>` unless the value is a status word such as `present`, `absent`, `ok`, or `http-200`. The workflows themselves follow the same rule, so a role ARN or token never appears in a run log; `ops-axi` only confirms presence.

## Operations

`ops-axi --help` lists every command. The catalog lives in `lib/catalog.js`. Adding an operation is one entry: name, repository, workflow file, default ref, optional positional input, optional Doppler default, optional verify list.

`cursor factory` is not a command. `walk dyad` and `walk vibe` are added when `ui-walk.yml` exists. `pr open` dispatches `pr-open.yml`, which uses a GitHub App to push the branch and open the pull request. That workflow does not merge.

## Tests

```sh
npm test --prefix packages/ops-axi
```

The tests use an in-process fake `gh` (`test/fake_gh.mjs`), so they need no network and no token. The root `npm test` runs them too.

## In the toolbox image

`docker/axi/Dockerfile` copies this directory into `/opt/axi/local` through the named build context `ops-axi` and links `ops-axi` into `/opt/axi/bin`. See `docs/axi-toolbox.md`.
