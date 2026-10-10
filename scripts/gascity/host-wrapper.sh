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

# GAS_CITY_WRAPPER_DRY=1 exercises the Doppler calls without root, git, or Dagger.
if [[ "${GAS_CITY_WRAPPER_DRY:-}" != 1 && "$(id -u)" -ne 0 ]]; then
  echo "gascity-rollout must run as root" >&2
  exit 2
fi

REPO=/opt/gascity/weaver-plus
BRANCH=cursor/browser-dyad-ui-bbea
# Phase 3 of plans/doppler-organization.md installs the prd file; until it
# exists the preview file is used as before.
PRD_TOKEN_FILE=/etc/doppler/dyad-prd.token
PREVIEW_TOKEN_FILE=/etc/doppler/dyad-preview.token
AWS_TOKEN_FILE=/etc/doppler/aws-dev.token
ENV_FILE=/run/gascity-rollout.env

# A token forwarded by the workflow covers both configs and nothing is read
# from disk. With no token, a service token is bound to one config, so the
# file decides what is downloaded.
FORWARDED="${DOPPLER_TOKEN:-}"
if [[ -z "$FORWARDED" ]]; then
  if [[ -f "$PRD_TOKEN_FILE" ]]; then
    TOKEN_FILE="$PRD_TOKEN_FILE"
    TOKEN_CONFIG=prd
  elif [[ -f "$PREVIEW_TOKEN_FILE" ]]; then
    TOKEN_FILE="$PREVIEW_TOKEN_FILE"
    TOKEN_CONFIG=preview
  else
    echo "Missing Doppler token file $PRD_TOKEN_FILE or $PREVIEW_TOKEN_FILE" >&2
    exit 2
  fi
  if [[ ! -f "$AWS_TOKEN_FILE" ]]; then
    echo "Missing Doppler token file $AWS_TOKEN_FILE" >&2
    exit 2
  fi
fi

if [[ "${GAS_CITY_WRAPPER_DRY:-}" != 1 && "${GAS_CITY_WRAPPER_INNER:-}" != 1 ]]; then
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

preview="$(mktemp)"
aws_json="$(mktemp)"
merged="$(mktemp)"
trap 'rm -f "$preview" "$aws_json" "$merged" "$ENV_FILE"' EXIT
doppler_bin="${DOPPLER_BIN:-/usr/bin/doppler}"
if [[ -n "$FORWARDED" ]]; then
  echo "doppler_source=env"
  DOPPLER_PROJECT=dyad DOPPLER_CONFIG=preview DOPPLER_TOKEN="$FORWARDED" \
    "$doppler_bin" secrets download --no-file --format json > "$preview"
  DOPPLER_PROJECT=aws DOPPLER_CONFIG=dev DOPPLER_TOKEN="$FORWARDED" \
    "$doppler_bin" secrets download --no-file --format json > "$aws_json"
else
  echo "doppler_source=file"
  DOPPLER_TOKEN="$(<"$TOKEN_FILE")"
  DOPPLER_PROJECT=dyad DOPPLER_CONFIG="$TOKEN_CONFIG" DOPPLER_TOKEN="$DOPPLER_TOKEN" \
    "$doppler_bin" secrets download --no-file --format json > "$preview"
  unset DOPPLER_TOKEN
  DOPPLER_TOKEN="$(<"$AWS_TOKEN_FILE")"
  DOPPLER_PROJECT=aws DOPPLER_CONFIG=dev DOPPLER_TOKEN="$DOPPLER_TOKEN" \
    "$doppler_bin" secrets download --no-file --format json > "$aws_json"
fi
unset DOPPLER_TOKEN FORWARDED
if [[ "${GAS_CITY_WRAPPER_DRY:-}" == 1 ]]; then
  exit 0
fi
python3 - "$preview" "$aws_json" "$merged" << 'PY'
import json
import sys

preview = json.load(open(sys.argv[1], encoding="utf-8"))
aws = json.load(open(sys.argv[2], encoding="utf-8"))
if not isinstance(preview, dict) or not isinstance(aws, dict):
    raise SystemExit("Doppler JSON must be an object of string values")
for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"):
    preview[name] = aws.get(name, "")
with open(sys.argv[3], "w", encoding="utf-8") as handle:
    json.dump(preview, handle)
PY
python3 "$REPO/scripts/gascity/write_rollout_env.py" "$ENV_FILE" < "$merged"
rm -f "$preview" "$aws_json" "$merged"
chmod 600 "$ENV_FILE"

cd "$REPO"
env -u DOPPLER_TOKEN DAGGER_NO_NAG=1 \
  /usr/local/bin/dagger --progress=plain -m deploy/gascity call rollout \
  --commit="$COMMIT" --docker=unix:///var/run/docker.sock
