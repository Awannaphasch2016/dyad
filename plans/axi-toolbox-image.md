# AXI toolbox image

One container image holds `gh`, `gh-axi`, and this repo's own operations AXI. An agent that drives GitHub from a shell runs that image, or installs from it, and gets the same tools, the same versions, and no token baked in.

This plan does not change any workflow in group 4. It does not fork `gh-axi`. It does not build the operations AXI; that CLI has its own plan and arrives in the image when it exists.

## What you can check

1. `docker run --rm ghcr.io/awannaphasch2016/axi-toolbox:<tag> gh-axi --version` prints the pinned version. `gh --version` and `node --version` print theirs.
2. `docker run --rm ghcr.io/awannaphasch2016/axi-toolbox:<tag> gh-axi run list` with no token exits non-zero and prints the AXI `AUTH_REQUIRED` error, not a stack trace.
3. The same command with `-e GH_TOKEN=…` prints the last ten runs of this repo in TOON form. `GH_REPO` already defaults to this repo inside the image.
4. `docker inspect` shows user `agent`, not root. `docker history` shows no `GH_TOKEN`, `GITHUB_TOKEN`, or `DOPPLER_TOKEN` layer.
5. A GitHub Actions job declares `container: ghcr.io/awannaphasch2016/axi-toolbox@sha256:…` and runs `gh-axi pr view "$PR"` with only `GH_TOKEN: ${{ github.token }}`. It installs nothing.
6. On Devbox `Wewebplus-ci`, `docker run` of the image with the mounted `gh` config runs `gh-axi workflow run preview-wake.yml` and the run appears in the Actions tab.
7. In a Claude Code or Codex session started inside the image, the session begins with the `gh-axi` ambient context block, so the hooks were installed for the image user.
8. `bash docker/axi/toolbox.test.sh` passes locally without a token and without network after the image is built.

## What this adds

| Piece                                     | Role                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docker/axi/Dockerfile`                   | Node 24 slim, `gh`, pinned `gh-axi`, a slot for the operations AXI, user `agent`                |
| `docker/axi/tools.env`                    | One line per tool: name and pinned version. The Dockerfile reads only this file                 |
| `docker/axi/entrypoint.sh`                | Repairs the agent hooks when `HOME` is a mount, then runs the command                           |
| `docker/axi/toolbox.test.sh`              | Builds the image and checks items 1, 2, 4, and 7                                                |
| `.github/workflows/axi-toolbox-image.yml` | Builds on a change under `docker/axi/`, pushes `ghcr.io/<owner>/axi-toolbox`, prints the digest |
| `docs/axi-toolbox.md`                     | How to run it from Actions, Devbox, a Cursor cloud agent, and a laptop                          |

## Which AXIs

The image carries only the AXIs that talk to GitHub. The browser AXI needs Chrome and the review AXI needs a server; both are out of scope.

| Tool                | Source                                               | Pinned how                          | Why it is here                                                 |
| ------------------- | ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `gh`                | `.deb` from the `cli/cli` release, checksum verified | version in `tools.env`              | `gh-axi` shells out to it, and `gh auth` owns the login        |
| `gh-axi`            | npm, `gh-axi@0.1.36` today                           | version in `tools.env`              | Issues, pull requests, runs, workflow dispatch, releases       |
| `axi-sdk-js`        | npm, as a `gh-axi` dependency                        | the lockfile that `npm ci` produces | Shared by every `*-axi` CLI; not installed on its own          |
| operations AXI      | `packages/ops-axi` in this repo                      | the commit that built the image     | `preview up`, `preview wake`, `rollout`, once those exist      |
| `jq`, `git`, `curl` | Debian                                               | Debian stable                       | `gascity-rollout.yml` and the preview scripts already use them |

`tasks-axi`, `quota-axi`, and `chrome-devtools-axi` are not in the image. Adding one later is one line in `tools.env` and a rebuild.

## Image shape

Base `node:24-bookworm-slim`. `gh` is installed from the pinned release's `.deb` on `github.com/cli/cli`, after its SHA-256 is checked against the release checksum file, so the same version lands on amd64 and arm64. npm global installs go to `/opt/axi`, which is on `PATH` for every user. The install uses `npm install -g --ignore-scripts` with the exact version, so the image does not run package lifecycle scripts.

User `agent`, uid 10001, home `/home/agent`. The image runs as that user. Root is only used while installing.

`/opt/axi` is owned by root and the image runs as `agent`, so the `update` command that `axi-sdk-js` gives every AXI fails with a permission error instead of writing a newer version into a container that is about to be discarded. Versions change in `tools.env` only, and `docs/axi-toolbox.md` says so.

`gh-axi setup hooks` runs at build time as `agent`. That writes the Claude Code, Codex, and OpenCode SessionStart hooks into `/home/agent` (`.claude/settings.json`, `.codex/hooks.json`, `.codex/config.toml`, `.config/opencode/plugins/axi-gh-axi.js`). The Dockerfile then links the `gh-axi` Agent Skill that ships in the npm package into `/home/agent/.agents/skills/gh-axi` and `/home/agent/.claude/skills/gh-axi`. When a caller mounts their own home over `/home/agent`, those files vanish; the entrypoint runs `gh-axi setup hooks` again and relinks the skill when the hook file is missing, then execs the command. The entrypoint never touches `gh auth`.

The operations AXI slot is `/opt/axi/local`, filled from a named build context `ops-axi`. When built without that context it is a `scratch` stage holding only the stub; the workflow passes `build-contexts: ops-axi=packages/ops-axi`, so the published image carries the real CLI. A glob source does not work here: BuildKit transfers only the paths a `COPY` matches, so a glob with no match leaves the literal prefix absent and the build fails. The `ops-axi` binary links into `/opt/axi/bin`. In a build without the context, `ops-axi --help` prints that the tool is not installed in this image.

Image size target: under 400 MB. No Chromium, no Python, no AWS CLI. `deploy/preview/formula_ecs.mjs` talks to AWS with the SDK from the repo checkout, not from this image.

## Authentication

The image has no credentials. Each place that runs it provides one of:

| Where                 | Credential                                                      | Notes                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions        | `GH_TOKEN: ${{ github.token }}`                                 | `gh` reads `GH_TOKEN` without `gh auth login`. Dispatching another workflow needs `actions: write` on the job. A run started by `github.token` does start, because `workflow_dispatch` is exempt from the no-recursion rule. |
| Devbox `Wewebplus-ci` | `-v "$HOME/.config/gh:/home/agent/.config/gh:ro"`               | The Devbox already has a `gh` login. The mount is read-only.                                                                                                                                                                 |
| Cursor cloud agent    | `GH_TOKEN` from the environment                                 | The cloud agent has a repo-scoped token in its environment already.                                                                                                                                                          |
| Laptop                | the same read-only mount, or `GH_TOKEN` from a fine-grained PAT | The PAT needs Actions read and write, pull requests read and write.                                                                                                                                                          |

`GH_REPO=Awannaphasch2016/dyad` is set as an image default so `gh-axi` resolves the repo even without a checkout; `gh-axi` reads `--repo`, then `GH_REPO`, then the git remote. A caller running against another repo overrides it or passes `-R`.

The image does not receive `DOPPLER_TOKEN`, `EC2_SSH_KEY`, or any AWS key. The operations AXI only dispatches workflows; the workflows hold those secrets.

## Build and publish

File: `.github/workflows/axi-toolbox-image.yml`. Name: AXI toolbox image.

Triggers: `workflow_dispatch`, and `push` to the default branch when a file under `docker/axi/` or `packages/ops-axi/` changes. Until this lands on `main`, the push trigger lists the branch that carries it, the same as the other image workflows on this fork, and loses that line when it merges.

Permissions: `contents: read`, `packages: write`.

Steps:

1. Check out the commit.
2. Build `docker/axi/Dockerfile` for `linux/amd64` and `linux/arm64`. The Devbox and GitHub runners are amd64; a laptop may be arm64.
3. Run `docker/axi/toolbox.test.sh` against the amd64 image before any push.
4. Push `ghcr.io/<owner>/axi-toolbox:sha-<commit>` and `ghcr.io/<owner>/axi-toolbox:<gh-axi version>`. Print the digest as the last line: `image=ghcr.io/<owner>/axi-toolbox@sha256:…`.
5. Nothing moves `latest`. Consumers pin the digest, like `preview.yml` pins the `dyad` digest.

Concurrency group `axi-toolbox-image`, cancel-in-progress false.

The job that dispatches workflows from inside this image is not this workflow. This workflow only builds.

## Where it runs

**GitHub Actions.** A job sets `container: ghcr.io/<owner>/axi-toolbox@sha256:…` and gets `gh-axi` without an install step. The first candidates are the review and alert workflows that today run `gh` and `jq` from the runner image: `pr-review-alerts.yml`, `github-security-advisory-alerts.yml`, `claude-check-workflows.yml`. Moving one of them is a separate change and is listed under what you can check as item 5, using the smallest one.

**Devbox `Wewebplus-ci`.** `preview-up.sh` already runs there with Docker. `docker run --rm -v "$HOME/.config/gh:/home/agent/.config/gh:ro" ghcr.io/<owner>/axi-toolbox@sha256:… gh-axi …` is the only new command. No install on the Devbox.

**Cursor cloud agent.** This repo has no `.cursor/environment.json`. When one is written, its install step copies the two binaries out of the image: `docker create` the image, `docker cp /opt/axi` into `/opt/axi`, add it to `PATH`, and run `gh-axi setup hooks`. That keeps the Cursor VM's own Node and `gh` and still pins the same `gh-axi`. Running the agent inside the image is not the plan; the agent needs the full repo toolchain, which this image does not carry.

**Claude Code and Codex on a laptop.** `docker run -it` with the home mount above, working directory mounted at `/work`. The entrypoint repairs the hooks, the session starts with the ambient context, and the skill tells the agent to call `gh-axi` rather than `gh`.

## Tests

`docker/axi/toolbox.test.sh` builds the image with a local tag and checks:

- `gh-axi --version` equals the version in `tools.env`. `gh --version` equals its pin.
- `whoami` inside the container is `agent`.
- `gh-axi run list` without a token exits non-zero and the output contains `AUTH_REQUIRED`.
- `docker history --no-trunc` contains none of `GH_TOKEN=`, `GITHUB_TOKEN=`, `DOPPLER_TOKEN=`.
- `/home/agent/.claude/settings.json` exists and names `gh-axi`.
- Mounting an empty directory over `/home/agent` and running `true` through the entrypoint leaves that same settings file behind, so the repair works.
- `ops-axi --help` exits 0 and either prints the command list or prints that the tool is not installed.

The workflow runs this script before pushing. The script needs Docker and does not need a GitHub token.

A unit test in `deploy/preview/` style reads `axi-toolbox-image.yml` and asserts: `packages: write`, no `id-token`, no `DOPPLER_TOKEN`, no `EC2_SSH_KEY`, no `13.251.216.187`, and that the push trigger is path-filtered.

## Status

The first image is published from commit `5e952bb`:

`ghcr.io/awannaphasch2016/axi-toolbox@sha256:1cdfdfc68982bf89728fd4cd1d89ca781fd00534634ba200a69117c4a49b0024`

Tags `0.1.36` and `sha-5e952bbca6729cfc2383e23f182788a8d3d8cd6b`, for `linux/amd64` and `linux/arm64`. `toolbox.test.sh` passed in the run before the push. The package is public on GHCR.

## What you do

1. Try check 3 with your own token against the digest above.
2. Decide whether `pr-review-alerts.yml` is the first workflow to move onto the image.
3. When this merges to `main`, drop `cursor/axi-toolbox-image-plan-531e` from the workflow's push branches.

Nothing in AWS, Doppler, or Cloudflare changes.

## Out of scope

- Adding `workflow_dispatch` inputs to the group 4 workflows. That is the prerequisite for the operations AXI and has its own plan.
- Writing `packages/ops-axi`. This image only reserves the slot.
- `chrome-devtools-axi`, `lavish-axi`, `tasks-axi`, `quota-axi`.
- Replacing `gh` in any workflow file. Workflows keep calling `gh`; agents call `gh-axi`.
- Making this image the dev container for building Dyad. `.devcontainer/devcontainer.json` stays on the universal image.
- Running the Cursor cloud agent inside this image.
- A `latest` tag.
