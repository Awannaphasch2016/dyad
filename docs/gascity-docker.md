# Interim Gas City Docker deployment

This runs the current Electron Weaver Plus UI in Xvfb and exposes that real UI
through noVNC. It is a pragmatic Linux remote-desktop deployment, not the
planned CloudHost web shell.

## Run

Docker Compose v2 and a Linux Docker host are required. From this fork's
checkout:

```sh
export NOVNC_PASSWORD='choose-a-strong-remote-desktop-password'
export GAS_CITY_HOST_BRIDGE_TOKEN='choose-a-separate-long-random-token'
export WEAVER_PROJECTS_DIR='/opt/gascity/projects'
docker compose -f compose.gascity.yml up --build -d
```

Open `http://HOST:6080/vnc.html` and enter `NOVNC_PASSWORD`. Set
`NOVNC_PORT` before starting to use another noVNC port; `NOVNC_GEOMETRY`
controls the virtual display size.

The compose file deliberately uses Linux host networking. The Gas City bridge
binds to `127.0.0.1` (default port `32100`) unless `GAS_CITY_HOST_BRIDGE_HOST`
is set to another IP address. This compose file does not set that variable.
Do not publish port `32100`. `compose.bridge-proof.yml` is a separate
unpublished network and is the only file that sets the bind address to
`0.0.0.0`. Host networking also means the noVNC port is opened directly by the
container, so protect it with a firewall and a strong password.

These named volumes survive container replacement:

- `weaver-plus-user-data` mounts `/home/weaver/.config`, including Weaver Plus
  settings, database, Electron/Chromium state, and credentials entered in the
  UI.
- `WEAVER_PROJECTS_DIR` mounts `/home/weaver/dyad-apps`, the default app
  projects directory. Set it to Gas City's project root when both processes
  must edit the same working trees. If it is unset, the
  `weaver-plus-projects` named volume is used.

Back up both volumes together. If the custom projects-folder setting points
outside `/home/weaver/dyad-apps`, mount that location separately.

`GAS_CITY_HOST_BRIDGE_ENABLED`, `GAS_CITY_HOST_BRIDGE_PORT`, and
`GAS_CITY_HOST_BRIDGE_TOKEN` are passed at container runtime. The two
passwords/tokens are required by the compose example and are never build
arguments or image contents. Avoid placing them in files committed to source
control.

## Sign-in and the browser URL

`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `WEWEBPLUS_DATABASE_URL`, and
`WEWEBPLUS_SECRETS_KEY` are passed through at runtime the same way. With the
Clerk pair set, the UI requires sign-in; with the database URL as well, shared
org accounts are on. Leave them unset for an ungated local app.

`DYAD_BROWSER_BRIDGE=1` makes the packaged app also serve its own renderer on
`127.0.0.1:${DYAD_BROWSER_BRIDGE_PORT:-8372}` with a `window.electron` that
talks to the main process over a websocket. That is the same UI the Xvfb
window shows, reachable from any browser. Put a tunnel (for example
`cloudflared tunnel --url http://127.0.0.1:8373`) in front of that port and add
the tunnel hostname to the Clerk instance's allowed origins. On a host where
the Gas City supervisor already owns `8372`, set `DYAD_BROWSER_BRIDGE_PORT`
to something else. The port stays on loopback; never publish it directly.

To stop the deployment:

```sh
docker compose -f compose.gascity.yml down
```

Omit `-v` to retain user data and projects.

## Continuous delivery

Pushes to `cursor/browser-dyad-ui-bbea` run `.github/workflows/gascity-rollout.yml` after `ci.yml` succeeds for that commit. The workflow can also be started with `workflow_dispatch`. GitHub Actions only SSHs to the host, using the `EC2_SSH_KEY` secret synced from Doppler project `dyad`, config `preview`. It does not copy the rest of that config.

On the host, `/usr/local/sbin/gascity-rollout` reads a Doppler service token for project `dyad`, config `prd`, from `/etc/doppler/dyad-preview.token`, and a second token from `/etc/doppler/aws-dev.token` (project `aws`, config `dev`). It writes a root-only env file and calls the Dagger module in `deploy/gascity`. Dagger uses the host Docker socket to run `scripts/gascity/rollout.sh` in the host namespaces. That script fast-forwards `/opt/gascity/weaver-plus`, tags the running `weaver-plus:gascity` image as `weaver-plus:gascity-previous`, then runs `docker compose -f compose.gascity.yml up --build -d` with project name `weaver-plus`. There is no `-v`. The rollout does not pull from a registry.

`.github/workflows/preview-image.yml` builds `Dockerfile.gascity` and pushes `ghcr.io/<owner>/dyad:sha-<commit>` when that tag is missing. A second run for the same commit does not build again. After the tag exists, the same workflow logs in with the Namespace GitHub app and runs `scripts/gascity/preview-up.sh` on Devbox `Wewebplus-ci` for the open pull request. When the `DOPPLER_TOKEN` GitHub secret is set, that job also points the preview at a Neon branch named `preview-pr-<number>` under project `Wewebplus-hitl`. The existing tunnel token on that Devbox is reused. `.github/workflows/preview.yml` creates and destroys other labeled pull requests. The city volume stays empty: the `gc` supervisor binary is not in this image. The workflow does not SSH to the production host, and the host does not pull the image.

`.github/workflows/preview-exec.yml` logs in with the Namespace GitHub app and runs on Devbox `Wewebplus-ci`. Project `preview-20` there includes `cloudflared`, and `https://pr-20.anakwannaphaschaiyong.com` returns the browser bridge. The workflow does not SSH to the production host.

`compose.preview.yml` is a separate Compose project for one pull request. It pulls a `ghcr.io` digest, puts Dyad on a bridge network, and does not publish port 32100. The city volume is created empty. `scripts/gascity/preview-up.sh` refuses to run when `/opt/gascity/weaver-plus` exists, checks that the Docker root has 8GiB free, and starts project `preview-<pr>`. With `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_ACCOUNT_ID` set, it creates the named tunnel and the `pr-<pr>.anakwannaphaschaiyong.com` CNAME. Those values stay in `~/.local/state/wewebplus-preview/` and are not written to git.

The bridge settings are fixed in that env file: `DYAD_BROWSER_BRIDGE=1`, `DYAD_BROWSER_BRIDGE_PORT=8373`, and `WEAVER_PROJECTS_DIR=/opt/gascity/projects`. The same file passes `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` (`ap-southeast-1`). When both IAM variables are set, the Bedrock client signs with SigV4 and does not send a bearer token saved in user settings. `/opt/gascity/projects` stays bind-mounted at `/home/weaver/dyad-apps`. The named volume `weaver-plus_weaver-plus-user-data` stays mounted at `/home/weaver/.config`.

If the new container does not become healthy, listen on `8373`, or show both organization members their existing apps on `main`, the script tags `weaver-plus:gascity-previous` back to `weaver-plus:gascity` and runs `docker compose up -d --no-build --force-recreate`. A later rollout does not create an app.
