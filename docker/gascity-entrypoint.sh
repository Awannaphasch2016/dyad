#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ! "${NOVNC_PORT:-6080}" =~ ^[0-9]+$ ]] \
  || (( NOVNC_PORT < 1 || NOVNC_PORT > 65535 )); then
  echo "NOVNC_PORT must be an integer from 1 to 65535" >&2
  exit 2
fi

if [[ -z "${NOVNC_PASSWORD:-}" ]]; then
  echo "NOVNC_PASSWORD is required; pass it only at runtime" >&2
  exit 2
fi

export PATH="/city/bin:${PATH}"
export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/weaver-runtime}"
mkdir -p "$XDG_RUNTIME_DIR" "$DYAD_DEV_USER_DATA_DIR" "$HOME/dyad-apps"
chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$DYAD_DEV_USER_DATA_DIR"/Singleton{Cookie,Lock,Socket}

password_file="$(mktemp)"
children=()
stopping=0

shutdown() {
  local status="${1:-0}"
  if (( stopping )); then
    return
  fi
  stopping=1
  trap - INT TERM HUP EXIT
  if ((${#children[@]})); then
    kill -TERM "${children[@]}" 2>/dev/null || true
    wait "${children[@]}" 2>/dev/null || true
  fi
  rm -f "$password_file" /tmp/weaver-plus-ready
  exit "$status"
}

trap 'shutdown 130' INT
trap 'shutdown 143' TERM HUP
trap 'shutdown $?' EXIT

x11vnc -storepasswd "$NOVNC_PASSWORD" "$password_file" >/dev/null
unset NOVNC_PASSWORD

Xvfb "$DISPLAY" \
  -screen 0 "${NOVNC_GEOMETRY:-1600x900}x24" \
  -nolisten tcp \
  -ac &
children+=("$!")

for _ in {1..100}; do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${children[0]}" 2>/dev/null; then
    echo "Xvfb exited before the display became ready" >&2
    exit 1
  fi
  sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || {
  echo "Timed out waiting for Xvfb" >&2
  exit 1
}

openbox &

x11vnc \
  -display "$DISPLAY" \
  -rfbauth "$password_file" \
  -rfbport 5900 \
  -forever \
  -shared \
  -localhost \
  -noxdamage &
children+=("$!")

websockify \
  --web=/usr/share/novnc/ \
  "$NOVNC_PORT" \
  127.0.0.1:5900 &
children+=("$!")

dbus-run-session -- /app/out/dyad-linux-x64/dyad \
  --no-sandbox \
  --user-data-dir="$DYAD_DEV_USER_DATA_DIR" &
children+=("$!")

ready=0
for _ in {1..120}; do
  for pid in "${children[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A deployment process exited during startup" >&2
      exit 1
    fi
  done
  if curl --fail --silent \
      "http://127.0.0.1:${NOVNC_PORT}/vnc.html" >/dev/null \
      && (exec 3<>/dev/tcp/127.0.0.1/5900) 2>/dev/null; then
    exec 3>&-
    exec 3<&-
    ready=1
    break
  fi
  sleep 0.5
done

if (( ! ready )); then
  echo "Timed out waiting for noVNC and VNC readiness" >&2
  exit 1
fi

touch /tmp/weaver-plus-ready
echo "Weaver Plus is ready at http://localhost:${NOVNC_PORT}/vnc.html"

set +e
wait -n -p exited_pid "${children[@]}"
status=$?
set -e
echo "Deployment process ${exited_pid:-unknown} exited with status $status" >&2
shutdown "$status"
