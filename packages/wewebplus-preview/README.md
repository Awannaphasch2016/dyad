# wewebplus-preview

Container image for the Wewebplus preview CLI. This directory is the piece to copy into a future `axi-awesome` repository. That repository does not exist yet, and this change does not create it.

The image does not contain the Dyad app. On any machine it checks the public preview URL and, when `GH_TOKEN` is set, dispatches the preview workflows. On the Devbox, mount the repo and the saved state and it runs the existing scripts. `resume` never builds an image.

## Pull

```sh
docker pull ghcr.io/awannaphasch2016/wewebplus-preview:edge
```

`sha-<commit>` is the immutable tag. `edge` moves when this workflow publishes.

## Run

```sh
docker run --rm ghcr.io/awannaphasch2016/wewebplus-preview:edge verify --pr 27
```

```sh
docker run --rm -e GH_TOKEN ghcr.io/awannaphasch2016/wewebplus-preview:edge resume --pr 27
```

That dispatches `Awannaphasch2016/dyad` at `cursor/formula-preview-9e7a`. Pass `--repo` and `--ref` to choose another checkout.

`workflow_dispatch` works after the workflow file is on the default branch. A refused dispatch prints the Re-run all jobs link for the last successful Preview image run.

On the Devbox:

```sh
docker run --rm \
  -e PREVIEW_REPO=/repo \
  -e PREVIEW_STATE_DIR=/state \
  -v /workspaces/weaver-plus:/repo \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.local/state/wewebplus-preview:/state" \
  ghcr.io/awannaphasch2016/wewebplus-preview:edge \
  resume --pr 27
```

`destroy` requires `--pr` and `--yes`. Secret values are never printed.
