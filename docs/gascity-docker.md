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
continues to bind only to `127.0.0.1` (default port `32100`), while Gas City on
the host can reach it through the shared network namespace. Do not publish the
bridge or change its bind address to `0.0.0.0`. Host networking also means the
noVNC port is opened directly by the container, so protect it with a firewall
and a strong password.

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

To stop the deployment:

```sh
docker compose -f compose.gascity.yml down
```

Omit `-v` to retain user data and projects.
