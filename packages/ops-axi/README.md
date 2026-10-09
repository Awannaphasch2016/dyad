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

GitHub only dispatches workflow files that exist on the repository's default branch. Most of this fork's operational workflows live on feature branches, so a dispatch is refused with "Workflow does not have 'workflow_dispatch' trigger". `ops-axi` then reruns the latest run of that workflow on `--ref` and reports `mode: rerun` with the commit it reran. A rerun uses that run's commit, not the branch tip; push the branch to get a fresh run if the workflow file changed. If a run is still in progress, `ops-axi` attaches to it (`mode: attach`).

## Secrets

Result lines whose key looks like a secret (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `ARN`) are printed as `<redacted>` unless the value is a status word such as `present`, `absent`, `ok`, or `http-200`. The workflows themselves follow the same rule, so a role ARN or token never appears in a run log; `ops-axi` only confirms presence.

## Operations

| Command          | Workflow                   | Default ref                          | Verifies                               |
| ---------------- | -------------------------- | ------------------------------------ | -------------------------------------- |
| `ec2 check`      | `ec2-access-check.yml`     | `cursor/axi-toolbox-image-plan-531e` | run passes                             |
| `formula role`   | `preview-formula-role.yml` | `cursor/formula-config-ui-55d6`      | run passes                             |
| `formula verify` | `ec2-access-check.yml`     | `cursor/axi-toolbox-image-plan-531e` | `AWS_PREVIEW_FORMULA_ROLE_ARN=present` |
| `formula deploy` | `preview-formula.yml`      | `cursor/formula-config-ui-55d6`      | `url=https://…`                        |
| `rollout <sha>`  | `gascity-rollout.yml`      | `cursor/browser-dyad-ui-bbea`        | run passes                             |
| `doppler status` | `doppler-organize.yml`     | `cursor/axi-toolbox-image-plan-531e` | `doppler_oidc=http-200…`               |

The catalog lives in `lib/catalog.js`. Adding an operation is one entry: name, workflow file, default ref, optional positional input, optional verify list.

## Tests

```sh
npm test --prefix packages/ops-axi
```

The tests use an in-process fake `gh` (`test/fake_gh.mjs`), so they need no network and no token. The root `npm test` runs them too.

## In the toolbox image

`docker/axi/Dockerfile` copies this directory into `/opt/axi/local` through the named build context `ops-axi` and links `ops-axi` into `/opt/axi/bin`. See `docs/axi-toolbox.md`.
