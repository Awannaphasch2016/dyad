#!/usr/bin/env bash
# One preview control action on the machine that already has the containers.
# Does not build an image and does not print secret values.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

action="${1:-}"
pr="${2:-}"
git_branch="${3:-}"

case "$action" in
  resume | status | logs | destroy | deploy | db-status | db-ensure | db-assign)
    ;;
  *)
    echo "Usage: preview-control.sh <resume|status|logs|destroy|deploy|db-status|db-ensure|db-assign> [pr] [git-branch]" >&2
    exit 2
    ;;
esac

if [[ -n "$pr" && ! "$pr" =~ ^[0-9]+$ ]]; then
  echo "Pull request number is required" >&2
  exit 2
fi
if [[ -n "$git_branch" && ! "$git_branch" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Git branch is invalid" >&2
  exit 2
fi
if [[ "$git_branch" == "main" ]]; then
  echo "Refusing the main branch" >&2
  exit 2
fi

marker="${PREVIEW_PRODUCTION_MARKER:-/opt/gascity/weaver-plus}"
if [[ -e "$marker" ]]; then
  echo "Refusing to control previews where ${marker} exists" >&2
  exit 2
fi

state="${PREVIEW_STATE_DIR:-${HOME}/.local/state/wewebplus-preview}"
secrets="$state/controller.env"
if [[ -f "$secrets" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$secrets"
  set +a
fi

require_pr() {
  if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
    echo "Pull request number is required" >&2
    exit 2
  fi
}

case "$action" in
  resume)
    if [[ -n "$pr" ]]; then
      export PREVIEW_RESUME_ONLY="$pr"
    fi
    bash scripts/gascity/preview-resume.sh
    ;;
  status)
    shopt -s nullglob
    found=0
    for env_file in "$state"/preview-*.env; do
      base="$(basename "$env_file")"
      this="${base#preview-}"
      this="${this%.env}"
      if [[ ! "$this" =~ ^[0-9]+$ ]]; then
        continue
      fi
      if [[ -n "$pr" && "$this" != "$pr" ]]; then
        continue
      fi
      found=1
      image="$(awk -F= '/^PREVIEW_IMAGE=/ { print substr($0, index($0, "=")+1); exit }' "$env_file")"
      digest=unknown
      if [[ "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
        digest="$image"
      fi
      tunnel=absent
      if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=.' "$env_file"; then
        tunnel=named
      fi
      echo "preview_result pr=${this} action=status tunnel=${tunnel} digest=${digest}"
    done
    if [[ "$found" -eq 0 ]]; then
      echo "previews: 0 saved on Wewebplus-ci"
    fi
    ;;
  logs)
    require_pr
    docker logs --tail 400 "preview-${pr}-dyad-1" 2>&1 | tail -c 8000
    ;;
  destroy)
    require_pr
    existed=0
    if [[ -f "$state/preview-${pr}.env" || -f "$state/preview-${pr}.tunnel-token" || -f "$state/preview-${pr}.public-url" ]]; then
      existed=1
    fi
    bash scripts/gascity/preview-resume.sh "$pr"
    if [[ -f "$secrets" ]]; then
      node deploy/preview/controller.mjs destroy --pr "$pr" --git-branch "$git_branch" --vercel-project dyad
    fi
    rm -f "$state/preview-${pr}.env" "$state/preview-${pr}.tunnel-token" "$state/preview-${pr}.public-url"
    if [[ -f compose.preview.yml ]]; then
      docker compose -p "preview-${pr}" -f compose.preview.yml down -v --remove-orphans || true
    fi
    if [[ "$existed" -eq 0 ]]; then
      echo "preview_result pr=${pr} action=destroy result=already_absent"
    else
      echo "preview_result pr=${pr} action=destroy result=removed"
    fi
    ;;
  deploy)
    require_pr
    env_file="$state/preview-${pr}.env"
    image=""
    if [[ -f "$env_file" ]]; then
      image="$(awk -F= '/^PREVIEW_IMAGE=/ { print substr($0, index($0, "=")+1); exit }' "$env_file")"
    fi
    if [[ ! "$image" =~ ^ghcr\.io/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
      echo "preview-${pr} has no saved image." >&2
      echo "preview_result pr=${pr} action=deploy result=image_missing"
      exit 1
    fi
    PREVIEW_SKIP_TUNNEL=1 bash scripts/gascity/preview-up.sh "$pr" "$image"
    ;;
  db-status)
    require_pr
    neon_api=absent
    if [[ -n "${NEON_API_KEY:-}" ]]; then
      neon_api=present
    fi
    echo "preview_result pr=${pr} action=db-status neon=preview-pr-${pr} neon_api=${neon_api}"
    ;;
  db-ensure)
    require_pr
    if [[ -z "$git_branch" ]]; then
      echo "Git branch is required" >&2
      exit 2
    fi
    node deploy/preview/controller.mjs attach --pr "$pr" --git-branch "$git_branch" --vercel-project dyad
    ;;
  db-assign)
    require_pr
    if [[ -z "$git_branch" ]]; then
      echo "Git branch is required" >&2
      exit 2
    fi
    node deploy/preview/controller.mjs assign-page --pr "$pr" --git-branch "$git_branch" --vercel-project dyad
    ;;
esac
