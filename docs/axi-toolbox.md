# AXI toolbox image

`ghcr.io/awannaphasch2016/axi-toolbox` carries `gh`, `gh-axi`, `git`, `jq`, and `curl`, plus a slot for this repo's operations AXI. Agents that drive GitHub from a shell run this image, or copy its tools out, and get the same pinned versions everywhere.

The image has no credentials. Every caller supplies one at run time.

Files:

| File                                      | Role                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `docker/axi/Dockerfile`                   | The image                                                 |
| `docker/axi/tools.env`                    | The only place a version is set                           |
| `docker/axi/entrypoint.sh`                | Repairs agent session hooks when `/home/agent` is a mount |
| `docker/axi/toolbox.test.sh`              | Builds and checks the image; needs Docker, no token       |
| `docker/axi/toolbox-workflow.test.mjs`    | Checks the workflow and scripts without Docker            |
| `.github/workflows/axi-toolbox-image.yml` | Builds, tests, and pushes the image                       |

## Tags

The workflow pushes `:sha-<commit>` and `:<gh-axi version>` and prints one line, `image=ghcr.io/<owner>/axi-toolbox@sha256:…`, at the end of the run. Pin that digest where you use the image. There is no `latest` tag.

## Running it

The image user is `agent`, uid 10001, home `/home/agent`, working directory `/work`. `GH_REPO` defaults to this repository, so `gh-axi` works without a checkout. Pass `-R owner/repo` or set `GH_REPO` for another repository.

**GitHub Actions.** The job runs inside the image and uses the job token. Dispatching another workflow from inside needs `actions: write`.

```yaml
jobs:
  alerts:
    runs-on: ubuntu-latest
    container: ghcr.io/awannaphasch2016/axi-toolbox@sha256:…
    permissions:
      contents: read
      pull-requests: read
    steps:
      - env:
          GH_TOKEN: ${{ github.token }}
        run: gh-axi pr list --limit 5
```

**Devbox `Wewebplus-ci`, or a laptop with `gh auth login` done.** Mount the existing `gh` config read-only.

```sh
docker run --rm \
  -v "$HOME/.config/gh:/home/agent/.config/gh:ro" \
  ghcr.io/awannaphasch2016/axi-toolbox@sha256:… \
  gh-axi run list --limit 5
```

**A token instead of a login.** `GH_TOKEN` is enough; `gh` reads it directly. A fine-grained token needs Actions read and write and pull requests read and write for the commands the operations AXI will issue.

```sh
docker run --rm -e GH_TOKEN ghcr.io/awannaphasch2016/axi-toolbox@sha256:… gh-axi pr view 92
```

**Claude Code or Codex inside the image.** Mount your home over `/home/agent` and the working tree at `/work`. The entrypoint writes the Claude Code, Codex, and OpenCode SessionStart hooks and links the `gh-axi` skill into `~/.agents/skills` and `~/.claude/skills` when they are missing, then runs your command. The mounted directory must be writable by uid 10001 for that to happen; otherwise the entrypoint prints a warning and continues.

**Cursor cloud agent.** The agent needs the full repo toolchain, which this image does not carry, so do not run the agent inside it. Copy the tools out instead:

```sh
id="$(docker create ghcr.io/awannaphasch2016/axi-toolbox@sha256:…)"
sudo docker cp "$id:/opt/axi" /opt/axi
docker rm "$id"
export PATH=/opt/axi/bin:$PATH
gh-axi setup hooks
```

`/opt/axi` holds the npm install, so the host needs Node 20 or newer on `PATH`. `gh` is installed from a Debian package and is not in `/opt/axi`; use the host's `gh`.

## Bumping a version

1. Change `GH_VERSION` or `GH_AXI_VERSION` in `docker/axi/tools.env`.
2. Push. The workflow builds, runs `toolbox.test.sh`, and pushes the new tags.
3. Move the digest pins in any job that uses the image.

`gh-axi update` does not work inside the image: `/opt/axi` is owned by root and the image runs as `agent`. That is deliberate. A version that was updated inside a container would disappear with it.

## The operations AXI slot

`/opt/axi/local` receives `packages/ops-axi/dist` when that directory exists in the build context. Until it does, `ops-axi --help` prints that the tool is not installed in this image and exits 0. The operations AXI has its own plan and depends on the preview and rollout workflows accepting `workflow_dispatch` inputs first.

## What the image does not do

- It does not hold `DOPPLER_TOKEN`, `EC2_SSH_KEY`, or AWS keys. The workflows hold those.
- It does not include Chrome, so `chrome-devtools-axi` is not here.
- It does not replace `gh` inside workflow files. Workflows call `gh`; agents call `gh-axi`.
- It is not the dev container for building Dyad.
