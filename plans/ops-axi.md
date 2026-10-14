# ops-axi

Status: the command catalog is on `cursor/ops-axi-commands-f1a5`. Creating `Awannaphasch2016/ops-axi` returned `createRepository` 403 for this token, so the CLI and the image workflow are still in this repository. The image build is `.github/workflows/axi-toolbox-image.yml` on that branch. It publishes `ghcr.io/awannaphasch2016/axi-toolbox` with a commit tag and the `gh-axi` version. There is no `latest` tag. This plan does not sling a formula.

The image registry is GitHub Container Registry, `ghcr.io`. That is the registry `axi-toolbox` already uses. This plan does not publish to Google `gcr.io`.

## Repository

Create `Awannaphasch2016/ops-axi`. Move `packages/ops-axi` and `docker/axi` out of this repo into that one. The toolbox image builds from the new repository.

A catalog entry names the repository that owns the workflow. A Dyad command starts a workflow in `Awannaphasch2016/dyad`. A Forma command starts one in the Forma repository. An agent checked out on any repository installs the same binary from the image.

The six commands that already exist stay: `ec2 check`, `formula role`, `formula verify`, `formula deploy`, `doppler status`, `rollout`.

## Image

Publish `ghcr.io/awannaphasch2016/axi-toolbox`.

Tags are `sha-<commit>` and the `gh-axi` version from `docker/axi/tools.env`. The workflow prints `image=ghcr.io/awannaphasch2016/axi-toolbox@sha256:…`. There is no `latest` tag. The image has no Doppler token, no GitHub token, and no GitHub App private key.

`ops-axi toolbox use <digest>` replaces `/usr/local/bin/ops-axi` and `gh-axi` from that image and writes the digest into the cloud environment pin. Other sessions see it after the next environment build.

## Features

Every command takes `--project` and `--config`. A command that reads a second Doppler config also takes `--aws-project` and `--aws-config`. The default is the pair that command uses today. The job prints `project=` and `config=` before it reads secrets. A write with no default and no flags exits without changing anything.

A refused dispatch fails the command. The command does not rerun an older workflow run, because that rerun would ignore the arguments from this call.

| Feature             | Command                          | What it does                                                                              |
| ------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| Doppler report      | `ops-axi doppler status`         | Names and counts for the project. Already exists.                                         |
| Doppler copy        | `ops-axi doppler phase1`         | Copy manifest names into `ci` and `prd`.                                                  |
| Doppler check       | `ops-axi doppler verify`         | The copy matches the manifest.                                                            |
| Host check          | `ops-axi ec2 check`              | Actions can reach the EC2 host. Already exists.                                           |
| Host status         | `ops-axi host status`            | The commit the host is running. New workflow. Prints only.                                |
| Host rollout        | `ops-axi rollout <sha>`          | Roll the host forward. Already exists.                                                    |
| Formula role        | `ops-axi formula role`           | Store the preview role ARN. Already exists.                                               |
| Formula role check  | `ops-axi formula verify`         | The ARN is present. Already exists.                                                       |
| Formula status      | `ops-axi formula status`         | ECS service active, desired count 1, task health, URL. New workflow. Prints only.         |
| Formula deploy      | `ops-axi formula deploy`         | Deploy the formula pages to ECS. Already exists.                                          |
| Preview image       | `ops-axi preview image`          | Publish the Dyad image and update the shared preview.                                     |
| Preview up          | `ops-axi preview up <pr>`        | Add the `preview` label and watch `preview.yml`.                                          |
| Preview down        | `ops-axi preview down <pr>`      | Remove the `preview` label and watch `preview.yml`.                                       |
| Preview exec        | `ops-axi preview exec`           | Prove GitHub can run a preview on the Devbox.                                             |
| Preview wake        | `ops-axi preview wake`           | Start preview containers after cloudflared stops.                                         |
| Preview secrets     | `ops-axi preview secrets`        | Seal the Devbox controller key.                                                           |
| Preview status      | `ops-axi preview status <pr>`    | `preview-control.yml` action `status`.                                                    |
| Preview logs        | `ops-axi preview logs <pr>`      | `preview-control.yml` action `logs`.                                                      |
| Preview database    | `ops-axi preview db-status <pr>` | `preview-control.yml` action `db-status`.                                                 |
| Vibe status         | `ops-axi vibe status <pr>`       | HTTP status of the Cloudflare Worker URL. New workflow. Prints only.                      |
| Bolt status         | `ops-axi bolt status`            | HTTP status of `bolt-walkthrough-55d6`. New workflow. Prints only.                        |
| Forma status        | `ops-axi forma status`           | Vercel deployment state. New workflow. Prints only.                                       |
| Toolbox build       | `ops-axi toolbox image`          | Build and push the image.                                                                 |
| Toolbox status      | `ops-axi toolbox status`         | Published digest and tag. Prints only.                                                    |
| Toolbox pin         | `ops-axi toolbox use <digest>`   | Install that digest on this machine and write the pin.                                    |
| Cursor key          | `ops-axi cursor probe`           | `GET /v1/me`, then one plan-mode agent that the job deletes.                              |
| Walk Dyad           | `ops-axi walk dyad`              | `ui-walk.yml` with `dyad.json`. Added when that file exists.                              |
| Walk Vibe           | `ops-axi walk vibe`              | `ui-walk.yml` with `vibesdk.json`. Added when that file exists.                           |
| Walk status         | `ops-axi walk status`            | Last walk conclusion and artifact names. Prints only.                                     |
| Open a pull request | `ops-axi pr open <owner>/<repo>` | Dispatch the ops-axi workflow. A GitHub App pushes the branch and opens the pull request. |

`cursor factory` is not a command. It runs the old factory poller.

`pr open` does not merge. The GitHub App is installed only on the repositories this account wants agents to write. The app needs contents write and pull requests write on those repositories. The cloud agent's token only dispatches the workflow in `Awannaphasch2016/ops-axi`.

## Order

1. Create `Awannaphasch2016/ops-axi` and move the CLI, the Dockerfile, and the image workflow into it.
2. Publish `ghcr.io/awannaphasch2016/axi-toolbox@sha256:…` from that repository. `ops-axi toolbox status` prints the digest.
3. Add `--project` and `--config` to the six existing commands, and pass them through as workflow inputs.
4. Add `doppler phase1`, `doppler verify`, and the Devbox preview commands, including `preview status`, `preview logs`, and `preview db-status`.
5. Add the new read-only workflows: `host status`, `formula status`, `vibe status`, `bolt status`, `forma status`, `toolbox status`.
6. Add `cursor probe` and `toolbox use`.
7. Add `pr open` after the GitHub App is installed on the target repositories. That install is done in GitHub by the account owner.
8. Add `walk dyad` and `walk vibe` after `ui-walk.yml` exists.
9. Fake-`gh` tests cover the new names, the Doppler defaults, a write that refuses to run, a refused dispatch that does not rerun, and `preview up` adding the label.

## Done when

- `Awannaphasch2016/ops-axi` builds the image and the workflow prints a digest.
- `ops-axi --help` lists the commands above, except the walk commands while `ui-walk.yml` is absent.
- A command names its Doppler project and config, and a write without a default refuses to run.
- `ops-axi pr open` opens a pull request on a second repository through the GitHub App. The agent token cannot push to that repository.
- The image contains no secret.

## Out of scope

Google Container Registry. Merging the pull request a command opens. `cursor factory`. Slinging `speckit-phased`. Copying Doppler values into the cloud environment.
