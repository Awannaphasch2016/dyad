#!/usr/bin/env bash
# Start one preview Compose project on the current Docker engine.
# Refuses the production checkout. Does not copy /opt/gascity/city.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

pr="${1:-}"
image="${2:-}"

if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
  echo "Usage: preview-up.sh <pr-number> <ghcr.io/...@sha256:...>" >&2
  exit 2
fi

if [[ ! "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "Image must be a ghcr.io digest reference" >&2
  exit 2
fi

marker="${PREVIEW_PRODUCTION_MARKER:-/opt/gascity/weaver-plus}"
if [[ -e "$marker" ]]; then
  echo "Refusing to start a preview where ${marker} exists" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 2
fi

docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
# Namespace reports /var/lib/docker even when that path is not visible here.
if [[ -z "$docker_root" || ! -d "$docker_root" ]]; then
  docker_root="/"
fi
avail_kb="$(df -Pk "$docker_root" | awk 'NR==2 { print $4 }')"
min_kb=$((8 * 1024 * 1024))
if [[ -z "$avail_kb" || "$avail_kb" -lt "$min_kb" ]]; then
  echo "Need 8GiB free on ${docker_root} before pulling the preview image" >&2
  exit 2
fi

project="preview-${pr}"
state_dir="${PREVIEW_STATE_DIR:-${HOME}/.local/state/wewebplus-preview}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
env_file="${state_dir}/${project}.env"
token_file="${state_dir}/${project}.tunnel-token"

if [[ ! -f "$env_file" ]]; then
  umask 077
  bridge="$(openssl rand -hex 32)"
  novnc="$(openssl rand -hex 16)"
  cat > "$env_file" <<EOF
PREVIEW_PR=${pr}
PREVIEW_IMAGE=${image}
PREVIEW_ENV_FILE=${env_file}
GAS_CITY_HOST_BRIDGE_TOKEN=${bridge}
NOVNC_PASSWORD=${novnc}
EOF
  chmod 600 "$env_file"
fi

# Keep the digest for this run even when the env file already existed.
if grep -q '^PREVIEW_IMAGE=' "$env_file"; then
  sed -i "s|^PREVIEW_IMAGE=.*|PREVIEW_IMAGE=${image}|" "$env_file"
else
  printf 'PREVIEW_IMAGE=%s\n' "$image" >> "$env_file"
fi

if [[ "${PREVIEW_SKIP_TUNNEL:-}" != "1" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node 18+ is required to create the Cloudflare tunnel" >&2
    exit 2
  fi
  node "$root/scripts/gascity/preview-tunnel.mjs" "$pr" "$token_file"
  if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' "$env_file"; then
    grep -v '^CLOUDFLARE_TUNNEL_TOKEN=' "$env_file" > "${env_file}.tmp"
    mv "${env_file}.tmp" "$env_file"
  fi
  printf 'CLOUDFLARE_TUNNEL_TOKEN=' >> "$env_file"
  cat "$token_file" >> "$env_file"
  printf '\n' >> "$env_file"
  chmod 600 "$env_file" "$token_file"
fi

compose=(docker compose --env-file "$env_file" -p "$project" -f compose.preview.yml)
tunnel=0
if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.' "$env_file"; then
  tunnel=1
  compose+=(--profile tunnel)
fi

echo "Pulling ${image} for ${project}"
"${compose[@]}" pull dyad
echo "Starting ${project}"
"${compose[@]}" up -d --wait dyad
if [[ "$tunnel" -eq 1 ]]; then
  "${compose[@]}" up -d cloudflared
fi
echo "Checking factory API on the preview network"
"${compose[@]}" --profile check run --rm caller
echo "Preview project ${project} is up"
echo "City volume pr-${pr}-city is empty; this image does not run gc"
if [[ "$tunnel" -eq 1 ]]; then
  echo "https://pr-${pr}.anakwannaphaschaiyong.com"
fi
