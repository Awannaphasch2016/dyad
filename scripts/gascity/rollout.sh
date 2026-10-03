#!/usr/bin/env bash
# Rebuild weaver-plus:gascity on the EC2 host and switch back to the previous
# local image if the new container does not come up healthy.
set -euo pipefail

COMMIT="${1:-}"
if [[ ! "$COMMIT" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Refusing commit that is not a hex sha" >&2
  exit 2
fi
COMMIT="${COMMIT,,}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "rollout.sh must run as root on the host" >&2
  exit 2
fi

REPO=/opt/gascity/weaver-plus
COMPOSE_FILE="$REPO/compose.gascity.yml"
ENV_FILE=/run/gascity-rollout.env
PROJECT=weaver-plus
IMAGE=weaver-plus:gascity
PREVIOUS=weaver-plus:gascity-previous
BRANCH=cursor/browser-dyad-ui-bbea

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. The host wrapper must create it from Doppler." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Required env $name is empty" >&2
    exit 2
  fi
}
require_env NOVNC_PASSWORD
require_env GAS_CITY_HOST_BRIDGE_TOKEN
require_env CLERK_SECRET_KEY
require_env CLERK_PUBLISHABLE_KEY
require_env WEWEBPLUS_DATABASE_URL
require_env WEWEBPLUS_SECRETS_KEY
require_env AWS_ACCESS_KEY_ID
require_env AWS_SECRET_ACCESS_KEY
require_env AWS_REGION

export DYAD_BROWSER_BRIDGE=1
export DYAD_BROWSER_BRIDGE_PORT=8373
export WEAVER_PROJECTS_DIR=/opt/gascity/projects
export NOVNC_PORT=6080
export NOVNC_GEOMETRY=1600x900
export GAS_CITY_HOST_BRIDGE_ENABLED=true
export GAS_CITY_HOST_BRIDGE_PORT=32100

git_ubuntu() {
  runuser -u ubuntu -- "$@"
}

echo "Fast-forwarding $REPO to $COMMIT"
dirty="$(git_ubuntu git -C "$REPO" status --porcelain)"
if [[ -n "$dirty" ]]; then
  echo "Host checkout is not clean; refusing to roll out" >&2
  printf '%s\n' "$dirty" >&2
  exit 2
fi
git_ubuntu git -C "$REPO" fetch origin "$BRANCH"
if ! git_ubuntu git -C "$REPO" cat-file -e "${COMMIT}^{commit}"; then
  echo "Commit $COMMIT is not in the fetched history" >&2
  exit 2
fi
git_ubuntu git -C "$REPO" merge --ff-only "$COMMIT"
head_sha="$(git_ubuntu git -C "$REPO" rev-parse HEAD)"
want_sha="$(git_ubuntu git -C "$REPO" rev-parse "${COMMIT}^{commit}")"
if [[ "$head_sha" != "$want_sha" ]]; then
  echo "Checkout HEAD does not match the requested commit" >&2
  exit 2
fi

echo "Tagging the current image as $PREVIOUS"
docker image inspect "$IMAGE" >/dev/null
before_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
docker tag "$IMAGE" "$PREVIOUS"

ROLLED_BACK=0
rollback() {
  local status=$?
  trap - ERR
  if [[ "$ROLLED_BACK" -eq 1 ]]; then
    exit "$status"
  fi
  ROLLED_BACK=1
  echo "Rollout failed (status $status). Restoring $PREVIOUS"
  set +e
  if docker image inspect "$PREVIOUS" >/dev/null 2>&1; then
    docker tag "$PREVIOUS" "$IMAGE"
    docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-build --force-recreate
  else
    echo "Previous image tag is missing; left the current container in place" >&2
  fi
  exit "$status"
}
trap rollback ERR

echo "Removing dangling images before the build"
docker image prune -f >/dev/null

echo "Building and starting $IMAGE"
docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$COMPOSE_FILE" up --build -d

after_id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
if [[ "$after_id" == "$before_id" ]]; then
  echo "Image id unchanged; the build matched the image already tagged $IMAGE"
fi

mapfile -t ids < <(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q weaver-plus)
CID="${ids[0]:-}"
if [[ -z "$CID" ]]; then
  echo "Container id not found" >&2
  exit 1
fi
run_id="$(docker inspect --format '{{.Image}}' "$CID")"
if [[ "$run_id" != "$after_id" ]]; then
  echo "Running container is not the image tagged $IMAGE" >&2
  exit 1
fi

echo "Waiting for the container to become healthy"
healthy=0
health=""
for _ in $(seq 1 48); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CID")"
  if [[ "$health" == "healthy" ]]; then
    healthy=1
    break
  fi
  if [[ "$health" == "unhealthy" ]]; then
    echo "Container became unhealthy" >&2
    exit 1
  fi
  sleep 5
done
if [[ "$healthy" -ne 1 ]]; then
  echo "Container did not become healthy (last status: ${health})" >&2
  exit 1
fi

python3 - << 'PY'
import socket
sock = socket.create_connection(("127.0.0.1", 8373), 5)
sock.close()
PY

echo "Pointing saved Bedrock settings at the Singapore profile"
docker exec -i -u weaver "$CID" python3 - /home/weaver/.config/weaver-plus/user-settings.json \
  < "$REPO/scripts/gascity/use_singapore_bedrock_settings.py"

echo "Verifying org apps for both members"
docker exec -i "$CID" node --input-type=module - < "$REPO/scripts/gascity/verify_bridge.mjs"

echo "ROLLOUT_OK $head_sha"
trap - ERR
