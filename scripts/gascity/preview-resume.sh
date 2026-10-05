#!/usr/bin/env bash
# Start saved previews that already have a tunnel token.
# Does not pull an image, mint a tunnel token, or update Clerk.
# One preview failing does not stop the rest.
set -u

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

skip="${1:-}"
if [[ -n "$skip" && ! "$skip" =~ ^[0-9]+$ ]]; then
  echo "Usage: preview-resume.sh [pr-to-skip]" >&2
  exit 2
fi

# PREVIEW_RESUME_ONLY starts that pull request. The positional argument still
# means "skip this pull request" for a deploy that handles it separately.
only="${PREVIEW_RESUME_ONLY:-}"
if [[ -n "$only" && ! "$only" =~ ^[0-9]+$ ]]; then
  echo "PREVIEW_RESUME_ONLY must be a pull request number" >&2
  exit 2
fi

marker="${PREVIEW_PRODUCTION_MARKER:-/opt/gascity/weaver-plus}"
if [[ -e "$marker" ]]; then
  echo "Refusing to resume previews where ${marker} exists" >&2
  exit 2
fi

state_dir="${PREVIEW_STATE_DIR:-${HOME}/.local/state/wewebplus-preview}"
if [[ ! -d "$state_dir" ]]; then
  echo "No saved previews in ${state_dir}"
  exit 0
fi

min_mem_kb=$((3 * 1024 * 1024))
meminfo="${PREVIEW_MEMINFO_FILE:-/proc/meminfo}"
shopt -s nullglob
env_files=("$state_dir"/preview-*.env)
shopt -u nullglob

for env_file in "${env_files[@]}"; do
  base="$(basename "$env_file")"
  pr="${base#preview-}"
  pr="${pr%.env}"
  if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
    continue
  fi
  if [[ -n "$only" && "$pr" != "$only" ]]; then
    continue
  fi
  if [[ -n "$skip" && "$pr" == "$skip" ]]; then
    echo "preview-${pr} is handled by this deploy"
    continue
  fi
  image="$(awk -F= '/^PREVIEW_IMAGE=/ { print substr($0, index($0, "=")+1); exit }' "$env_file")"
  if [[ ! "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
    echo "preview-${pr} has no saved image. Left stopped."
    echo "preview_result pr=${pr} action=resume result=left_stopped"
    continue
  fi
  if ! grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.' "$env_file"; then
    echo "preview-${pr} has no tunnel token. Left stopped."
    echo "preview_result pr=${pr} action=resume result=left_stopped"
    continue
  fi
  mem_kb="$(awk '/MemAvailable:/ { print $2 }' "$meminfo" 2>/dev/null || true)"
  if [[ -z "$mem_kb" || "$mem_kb" -lt "$min_mem_kb" ]]; then
    echo "MemAvailable is ${mem_kb:-unknown}kB, below 3GiB. preview-${pr} was left stopped."
    echo "preview_result pr=${pr} action=resume result=left_stopped"
    continue
  fi
  echo "Resuming preview-${pr}"
  if ! docker compose --env-file "$env_file" -p "preview-${pr}" -f compose.preview.yml --profile tunnel up -d --no-recreate dyad cloudflared; then
    echo "preview-${pr} did not start. Other previews continue." >&2
    echo "preview_result pr=${pr} action=resume result=left_stopped"
  else
    echo "preview_result pr=${pr} action=resume result=started"
  fi
done
