#!/usr/bin/env bash
# Installed on the EC2 host as /usr/local/sbin/gascity-rollout.
# Fast-forwards the checkout, writes a root-only env file from Doppler, then
# asks Dagger to run scripts/gascity/rollout.sh on the host. The env file is
# removed when this process exits. Doppler's token is not passed to Dagger.
set -euo pipefail
umask 077

COMMIT="${1:-}"
if [[ ! "$COMMIT" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Refusing commit that is not a hex sha" >&2
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "gascity-rollout must run as root" >&2
  exit 2
fi

REPO=/opt/gascity/weaver-plus
BRANCH=cursor/browser-dyad-ui-bbea
TOKEN_FILE=/etc/doppler/dyad-preview.token
ENV_FILE=/run/gascity-rollout.env

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Missing Doppler token file $TOKEN_FILE" >&2
  exit 2
fi

if [[ "${GAS_CITY_WRAPPER_INNER:-}" != 1 ]]; then
  dirty="$(runuser -u ubuntu -- git -C "$REPO" status --porcelain)"
  if [[ -n "$dirty" ]]; then
    echo "Host checkout is not clean; refusing to roll out" >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  fi
  runuser -u ubuntu -- git -C "$REPO" fetch origin "$BRANCH"
  runuser -u ubuntu -- git -C "$REPO" merge --ff-only "$COMMIT"
  export GAS_CITY_WRAPPER_INNER=1
  exec "$REPO/scripts/gascity/host-wrapper.sh" "$COMMIT"
fi

download="$(mktemp)"
trap 'rm -f "$download" "$ENV_FILE"' EXIT
DOPPLER_TOKEN="$(<"$TOKEN_FILE")"
DOPPLER_PROJECT=dyad DOPPLER_CONFIG=preview DOPPLER_TOKEN="$DOPPLER_TOKEN" \
  /usr/bin/doppler secrets download --no-file --format json > "$download"
unset DOPPLER_TOKEN
python3 "$REPO/scripts/gascity/write_rollout_env.py" "$ENV_FILE" < "$download"
rm -f "$download"
chmod 600 "$ENV_FILE"

cd "$REPO"
env -u DOPPLER_TOKEN DAGGER_NO_NAG=1 \
  /usr/local/bin/dagger --progress=plain -m deploy/gascity call rollout \
  --commit="$COMMIT" --docker=unix:///var/run/docker.sock
