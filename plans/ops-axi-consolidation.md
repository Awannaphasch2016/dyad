# OPS-AXI consolidation

Status: audit recorded, and the legacy contract is now a test. No command behavior changed. The resource grammar, the registry, `host-exec`, `devbox-auth`, and session commands are not implemented.

Catalog base: `a9c0b41122a252aa0d389e456cd21f91258586c3` on `cursor/ops-axi-commands-f1a5`.

The machine-readable inventory is [packages/ops-axi/test/fixtures/baseline-contract.json](../packages/ops-axi/test/fixtures/baseline-contract.json). [packages/ops-axi/test/baseline.test.mjs](../packages/ops-axi/test/baseline.test.mjs) resolves every legacy argv and compares it to that file. A change to a command, a workflow input, or a default ref fails the test until the fixture is updated in the same change.

## Grammar that exists today

```
ops-axi <operation> [positional] [flags]
```

An operation is one catalog key, either two words (`formula role`) or one word (`rollout`). `run <workflow.yml> --ref <branch>` is the dispatch escape hatch. Help prints `operations[28]` because it counts `run` beside the 27 business operations. `run` is not one of the 27.

Flags the parser accepts: `--ref`, `--repo` / `-R`, `--project`, `--config`, `--aws-project`, `--aws-config`, `--field` / `-f` (the `run` escape hatch only; named operations ignore it), `--title`, `--head`, `--base` (default `main`), `--body`, `--source-repo`, `--source-ref`, `--no-wait`, `--json`, `--help` / `-h`, `--version` / `-v`.

Flags the proposal names that the parser rejects: `--app`, `--host`, `--target`, `--env`, `--pr`, `--sha`, `--digest`, `--profile`, `--provider`, `--format`, `--command`, `--phase`, `--type`. `--json` is the existing structured output. It is not `--format json`.

Positionals, when the catalog declares one: `pr` (digits), `sha` (7–40 hex, sent as `commit`), `digest` (`sha256:` plus 64 hex), `owner/repo`. `formula role` and `preview secrets` have no Doppler default. They throw `VALIDATION_ERROR` before `gh` unless `--project` and `--config` are present. `pr open` also requires `--title` and `--head`, and it does not merge.

`GH_REPO` applies only to `run`. A named operation uses `--repo` or the catalog repo.

## The 27 operations

| Legacy command           | Kind            | Workflow                   | defaultRef                               | Example fields                                                                         |
| ------------------------ | --------------- | -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `ec2 check`              | dispatch        | `ec2-access-check.yml`     | `cursor/axi-toolbox-image-plan-531e`     | `doppler-project=dyad`, `doppler-config=preview`                                       |
| `formula role`           | dispatch, write | `preview-formula-role.yml` | `cursor/formula-config-ui-55d6`          | Doppler flags required                                                                 |
| `formula verify`         | dispatch        | `ec2-access-check.yml`     | `cursor/axi-toolbox-image-plan-531e`     | verify `AWS_PREVIEW_FORMULA_ROLE_ARN=present`                                          |
| `formula deploy`         | dispatch, write | `preview-formula.yml`      | `cursor/formula-config-ui-55d6`          | verify `url` matches `^https?://`                                                      |
| `formula status`         | dispatch        | `formula-status.yml`       | `cursor/ops-axi-commands-f1a5`           | `dyad` / `preview`                                                                     |
| `doppler status`         | dispatch        | `doppler-organize.yml`     | `cursor/axi-toolbox-image-plan-531e`     | `command=status`, project `dyad`, no config; verify `doppler_oidc` matches `^http-200` |
| `doppler phase1`         | dispatch, write | `doppler-organize.yml`     | same                                     | `command=phase1`                                                                       |
| `doppler verify`         | dispatch        | `doppler-organize.yml`     | same                                     | `command=verify`                                                                       |
| `rollout <sha>`          | dispatch, write | `gascity-rollout.yml`      | `cursor/browser-dyad-ui-bbea`            | `commit`, `dyad`/`prd`, `aws`/`dev`                                                    |
| `host status`            | dispatch        | `host-status.yml`          | `cursor/ops-axi-commands-f1a5`           | `dyad`/`prd`, `aws`/`dev`                                                              |
| `preview image`          | dispatch, write | `preview-image.yml`        | `cursor/axi-toolbox-image-plan-531e`     | `dyad` / `preview`                                                                     |
| `preview up <pr>`        | label add       | `preview.yml`              | pull request head                        | field `pr` only; no Doppler fields sent                                                |
| `preview down <pr>`      | label remove    | `preview.yml`              | pull request head                        | same                                                                                   |
| `preview exec`           | dispatch, write | `preview-exec.yml`         | `cursor/axi-toolbox-image-plan-531e`     | Doppler fields; no caller command                                                      |
| `preview wake`           | dispatch, write | `preview-wake.yml`         | same                                     | Doppler fields                                                                         |
| `preview secrets`        | dispatch, write | `preview-secrets.yml`      | same                                     | Doppler flags required                                                                 |
| `preview status <pr>`    | dispatch        | `preview-control.yml`      | `cursor/ops-axi-commands-f1a5`           | `action=status`                                                                        |
| `preview logs <pr>`      | dispatch        | `preview-control.yml`      | same                                     | `action=logs`                                                                          |
| `preview db-status <pr>` | dispatch        | `preview-control.yml`      | same                                     | `action=db-status`                                                                     |
| `vibe status <pr>`       | dispatch        | `vibe-status.yml`          | same                                     | `pr` required by the workflow                                                          |
| `bolt status`            | dispatch        | `bolt-status.yml`          | same                                     | `bolt` / `preview`                                                                     |
| `forma status`           | dispatch        | `forma-status.yml`         | `main` of `Awannaphasch2016/forma`       | no fields                                                                              |
| `toolbox image`          | dispatch        | `axi-toolbox-image.yml`    | `cursor/ops-axi-commands-f1a5`           | no fields; verify `image` is `ghcr.io/…@sha256:…`                                      |
| `toolbox status`         | dispatch        | `toolbox-status.yml`       | same                                     | no fields                                                                              |
| `toolbox use <digest>`   | local docker    | none                       | none                                     | digest is not a workflow field                                                         |
| `cursor probe`           | dispatch        | `hitl-cursor-probe.yml`    | `cursor/gascity-consolidation-step-f1a5` | `dyad`/`preview` and `aws`/`dev`                                                       |
| `pr open <owner/repo>`   | dispatch, write | `pr-open.yml`              | `cursor/ops-axi-commands-f1a5`           | `target`, `title`, `head`, `base=main`                                                 |

`preview up` and `preview down` edit the `preview` label and then watch a `pull_request` run. `preview.yml` has no `workflow_dispatch`.

`toolbox use` calls `lib/toolbox.js`. It does not call `gh`.

Verification and redaction already have tests in `cli.test.mjs` and `run.test.mjs`. A refused dispatch throws `DISPATCH_REFUSED` and does not rerun. HTTP 403 stays `FORBIDDEN`. `plans/ec2-access-operation-axi.md` used to say a refused dispatch reruns the latest run. That sentence is corrected. The code has not rerun since the catalog commit.

## Where this checkout disagrees with the proposal

The proposal's `ops-axi <resource> <operation>` commands are a design target. Parsing one today fails with `Unknown flag` or `Unknown operation`. `pr open` is the exception: that spelling already exists. The fixture lists every proposed argv and the test rejects the ones that are not implemented.

These proposal rows do not match the code, so they must not be implemented by renaming alone:

- `preview exec --command` is not a shell argument. `preview-exec.yml` runs a fixed Devbox proof (`echo federated-ok`, then a fixed preview-20 script). The workflow has no `command` input.
- `session run --command "echo ok"` must not become string interpolation into SSM. When that command is added, the allowed action is an id such as `echo-ok`. The workflow contains that script. The CLI does not forward an arbitrary string.
- `formula role` still runs `scripts/gascity/setup_formula_role.py` over SSH and writes the role ARN to Doppler. A later `identity ensure` name has to call that same workflow.
- `formula deploy` calls `deploy/preview/formula_ecs.mjs`. The workflow file does not contain `ssh`.
- `preview image` updates the shared Devbox preview. It is not only an image build.
- `forma status` points at `Awannaphasch2016/forma`. The workflow file in this repository is `packages/ops-axi/workflows/forma-status.yml`, and its header says to copy it onto that repository. This checkout cannot dispatch it.
- `cursor probe` uses `cursor/gascity-consolidation-step-f1a5`. The probe file on that ref declares no Doppler inputs. The CLI still sends four Doppler fields.

### Dispatch input gap

A dispatch is accepted only when the workflow file is on the default branch. The CLI also passes `--ref` set to the catalog `defaultRef`. On 2026-10-16 the file at that ref, for thirteen operations, does not declare the Doppler fields the CLI sends. The copy of the same filename on this branch does declare them. This change did not dispatch, so it records the mismatch and does not decide which copy GitHub will read. The test freezes both input lists.

| Operation                                                          | Fields the ref file does not declare                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ec2 check`, `formula verify`                                      | `doppler-project`, `doppler-config` on `cursor/axi-toolbox-image-plan-531e`     |
| `formula role`, `formula deploy`                                   | those two fields on `cursor/formula-config-ui-55d6`                             |
| `doppler status`, `doppler phase1`, `doppler verify`               | `doppler-project` (`command` is declared)                                       |
| `preview image`, `preview exec`, `preview wake`, `preview secrets` | `doppler-project`, `doppler-config`                                             |
| `rollout`                                                          | the four Doppler fields (`commit` is declared) on `cursor/browser-dyad-ui-bbea` |
| `cursor probe`                                                     | all four Doppler fields on `cursor/gascity-consolidation-step-f1a5`             |

The frozen ref inputs were read from `origin/<ref>` on 2026-10-16. The test does not fetch those refs again. Operations whose `defaultRef` is `cursor/ops-axi-commands-f1a5` are compared to the file in this checkout, and their undeclared list is empty.

Moving a `defaultRef` changes which commit runs. This change does not do that. Closing the gap is its own pull request, after the workflow file that will actually be dispatched declares every field the CLI sends.

### Consumers

On this branch the command strings live in `packages/ops-axi/README.md`, the help text in `lib/cli.js`, `docs/axi-toolbox.md` (`ops-axi ec2 check` against the tagged image `ghcr.io/awannaphasch2016/axi-toolbox:0.1.36`), `plans/doppler-organization.md`, `plans/short-lived-host-auth.md`, and `plans/ec2-access-operation-axi.md`. `docker/axi/ops-axi-stub.sh` is the placeholder from before this package existed. Later plan branches name session commands that are not in the catalog. Aliases stay until those consumers move, and removal waits for an explicit approval.

### CI that already exists

`ci.yml` runs `npm run test` only when `github.repository == 'dyad-sh/dyad'`. This fork does not enter that job. The new `.github/workflows/ops-axi-ci.yml` runs `node --test packages/ops-axi/test/*.test.mjs` on pull requests and on `cursor/ops-axi-*` pushes that touch the package or workflow files. Permissions are `contents: read`. The job does not install dependencies and does not dispatch a catalog workflow.

`npm test` in the root `package.json` now includes `baseline.test.mjs` before `vitest`, so a checkout that does run the upstream unit job runs the contract too.

## What not to build

Do not add `config/resources/*.yml` beside `catalog.js`. That would be a second source of truth. The next registry module reads `OPERATIONS`.

Do not add the directory tree from the proposal's section 12 in one step. `cli.js`, `catalog.js`, `run.js`, `gh.js`, and `toolbox.js` already cover parsing, dispatch, label edits, redaction, and the local install.

Do not merge ECS, SSM, SSH, and Devbox into one shell. `formula deploy` stays on the AWS API. Preview lifecycle stays on Devbox and on the pull-request label. Host scripts stay separate: `check_host_access.py`, `setup_formula_role.py`, `host-wrapper.sh`, and the inline `git rev-parse` in `host-status.yml`.

Do not copy `preview-formula-role.yml` to invent session prepare. Do not widen the formula role's IAM policy so the CLI is easier to call. Do not replace Doppler. Do not start the PR #177 cherry-pick in these pulls.

## Pull request sequence

Each row is one pull request. The base of the next ops-axi pull is the catalog branch, then the previous ops-axi pull once it exists. None of these include the GasCity cherry-pick.

### A. This change — contract lock

Files:

- `packages/ops-axi/test/fixtures/baseline-contract.json`
- `packages/ops-axi/test/baseline.test.mjs`
- `packages/ops-axi/test/workflow_file.mjs`
- `.github/workflows/ops-axi-ci.yml`
- `package.json` (root `test` script)
- `plans/ops-axi-consolidation.md`
- one sentence in `plans/ec2-access-operation-axi.md`

`lib/cli.js` and `lib/catalog.js` are not edited.

### B. Registry view

New `packages/ops-axi/lib/registry.js` and `packages/ops-axi/test/registry.test.mjs`.

The module exports lookup over the existing `OPERATIONS` object: family, implementation, and capability derived from the legacy name (`vibe status` is family `ui`, implementation `vibe`, capability `status`). It does not own a copy of the workflow, ref, or fields. `resolve()` stays the executor.

A test registers a fictional UI by passing an extra object into the lookup function, not by editing `cli.js`. Unsupported capabilities return an error object. They do not fall through to another operation.

No new flags in this pull.

### C. Canonical aliases

Edit `lib/cli.js` and add alias coverage to the contract test.

Accepted aliases must resolve to the same `kind`, `repo`, `workflow`, `ref`, and `fields` as the legacy argv. The baseline fixture stays the legacy side. A second expectation lists the alias.

`--app` selects `vibe`, `bolt`, or `forma` for `status` only. `--pr`, `--sha`, and `--digest` are optional spellings of the existing positionals. `--env` and `--profile` are accepted only where they fill the Doppler or environment value the command already sends.

Still rejected: `--command`, `preview key seal` as a free command, `session *`, and `resource list` until the registry lookup is wired to help. `ops-axi ui status --help` can wait until the alias parser exists; help continues to come from the catalog.

An unknown family or an unsupported capability exits 2 with a distinct message (`Unknown operation` or `Unsupported capability`). It does not dispatch.

### D. Close the dispatch input gap

Separate from the alias pull, because it changes which ref runs.

For each of the thirteen gapped operations, either point `defaultRef` at a commit whose workflow declares the fields the CLI sends, or add those inputs on the ref that is already selected. The contract fixture's `undeclaredFields` becomes empty in that pull. Do not retarget `formula role` or `formula deploy` off `cursor/formula-config-ui-55d6` unless the formula workflow on the new ref is the same business script.

### E. `host-exec`

New `.github/actions/host-exec/action.yml`. It performs the SSH preamble these four workflows repeat: Doppler OIDC is already `.github/actions/doppler-oidc`; the composite owns the SSH key file (`scripts/gascity/write_ssh_key.py`), known hosts (`.github/gascity_known_hosts`), and the `ssh` options (`IdentitiesOnly`, `StrictHostKeyChecking`, `ConnectTimeout`).

Callers keep their own steps:

- `ec2-access-check.yml` → `scripts/gascity/check_host_access.py`
- `preview-formula-role.yml` → `scripts/gascity/setup_formula_role.py`
- `gascity-rollout.yml` → `scripts/gascity/host-wrapper.sh`, after its CI wait
- `host-status.yml` → the existing remote `git rev-parse`

The composite accepts the remote script. It does not choose the business operation. Tests for the composite are a workflow fixture or a shell test of the argument assembly, with no network. ECS workflows are not callers.

### F. `devbox-auth`

New `.github/actions/devbox-auth/action.yml` for the three repeated steps: Namespace login, Devbox CLI install at the version the workflows already pin, and the federated token file.

Callers:

- `preview-image.yml`
- `preview.yml`
- `preview-exec.yml`
- `preview-wake.yml`
- `preview-secrets.yml`
- `preview-control.yml`

Image build, Neon, the fixed `echo federated-ok` proof, wake, the controller key, and the control action stay in the caller. `preview-exec` does not grow a `command` input.

### G. Shared HTTP status, only for the two workers

`vibe-status.yml` and `bolt-status.yml` both `curl` a worker URL and print `url` and `http`. A composite can take the URL and the default Doppler names. `forma-status.yml` reads the GitHub deployments API and stays its own workflow.

### H. Session, after E and after SSM is reachable

Depends on the session-prepare plan that lives on `cursor/gascity-consolidated-execution-f1a5` (`plans/ops-axi-session-prepare.md`). That file is not in this checkout. Rebase it onto `host-exec` before writing the workflow. Not in the 27.

`session prepare` is a caller of `host-exec` plus a new host script that attaches `AmazonSSMManagedInstanceCore` when the instance profile already exists, and otherwise creates the profile. It does not call `ReplaceIamInstanceProfileAssociation`. It does not reuse `setup_formula_role.py`.

`session status` and `session run echo-ok` use SSM after `ping=Online`. The first run script is `echo ok`. The catalog name is `echo-ok`, not a `--command` string. Role `gascity-agent-exec` is limited to `ssm:SendCommand`, `ssm:GetCommandInvocation`, `ssm:DescribeInstanceInformation`, and `ec2:DescribeInstances` on this host and `AWS-RunShellScript`. No ECS actions. No `ssm:StartSession`.

The first proof is a push run of that workflow. A refused dispatch still fails.

### I. Extension proof

After B and G, a test adds a fictional UI implementation that reuses the HTTP status composite. The diff is the registry entry and the test. `cli.js` is untouched. A third implementation that does not list `health` returns the unsupported-capability error. This test stays in the suite.

### J. Docs

Update `packages/ops-axi/README.md` and the help examples to show the canonical spelling first, with the legacy spelling still accepted. Do not delete aliases in that pull.

## CI stages mapped onto this sequence

| Proposal stage                                                          | Where it lands                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Static syntax, workflow file exists, inputs, permissions, required args | A, extended by B and C                                                                                            |
| Legacy and proposed argv                                                | A, aliases in C                                                                                                   |
| Registry lookup                                                         | B                                                                                                                 |
| `host-exec` and `devbox-auth` argument tests                            | E and F                                                                                                           |
| Dispatch refusal, label trigger, result lines                           | already in `cli.test.mjs` and `run.test.mjs`                                                                      |
| Secret redaction                                                        | already in `run.test.mjs`; the fixture is scanned for token prefixes                                              |
| Live EC2, Devbox, ECS, Doppler, Cursor                                  | not in the pull-request job. A later manual workflow, after the dispatch gap is closed and a test target is named |

Failures in A name the legacy command (`legacy contract: formula role`). The job log is the report. It does not print tokens.

## Phase report

| Field         | This change                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase         | Audit, plus the contract-test half of the CI foundation. Registry, aliases, and execution extraction are not in this commit.                                                                                                                                                                                                                              |
| Commit        | `84e8c62` on `cursor/ops-axi-baseline-contract-f1a5`, based on `a9c0b411`. Pull request https://github.com/Awannaphasch2016/dyad/pull/181.                                                                                                                                                                                                                |
| Changed files | Fixture, baseline test, workflow parser helper, `ops-axi-ci.yml`, root `test` script, this plan, the refused-dispatch sentence in `plans/ec2-access-operation-axi.md`.                                                                                                                                                                                    |
| Behavior      | `resolve()` was not edited. Proposed commands still fail. The thirteen dispatch input gaps are recorded and left in place.                                                                                                                                                                                                                                |
| Compatibility | All 27 legacy commands still parse. No alias was added or removed.                                                                                                                                                                                                                                                                                        |
| CI            | Local `node --test packages/ops-axi/test/*.test.mjs`: 89 tests, 0 failures. GitHub run https://github.com/Awannaphasch2016/dyad/actions/runs/38845603799 (`ops-axi contract`) printed the same `# pass 89` / `# fail 0`. Upstream `ci.yml` unit tests do not run on this fork.                                                                            |
| Integration   | No `gh` dispatch, no SSH, no Doppler, no AWS, no Devbox.                                                                                                                                                                                                                                                                                                  |
| Security      | No workflow permission and no IAM policy edited. The new job requests `contents: read` only. The fixture test rejects `ghp_`, `github_pat_`, `gho_`, `AKIA`, private-key blocks, and `dp.st.` prefixes.                                                                                                                                                   |
| Outstanding   | Dispatch input gap on 13 operations. `forma-status.yml` is not on the forma repository. `cursor probe` still points at the consolidation ref. Canonical grammar, registry, `host-exec`, `devbox-auth`, and session commands are unbuilt. `plans/ec2-access-operation-axi.md` still describes an older, smaller command list below the corrected sentence. |
| Next          | B, the registry view over `catalog.js`, after this contract job is green. Do not start D, E, or H in that pull.                                                                                                                                                                                                                                           |
