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

state_dir="${PREVIEW_STATE_DIR:-${HOME}/.local/state/wewebplus-preview}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
# shellcheck source=controller-env.sh
source "$root/scripts/gascity/controller-env.sh"
secrets_file="${state_dir}/controller.env"
load_controller_cloudflare "$secrets_file"
normalize_cloudflare_aliases
upsert_controller_cloudflare "$secrets_file"
require_controller_cloudflare || exit 2

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
  echo "Need 8GiB free on ${docker_root} before pulling the preview image. Stopping this preview. Other previews were left running." >&2
  exit 2
fi

mem_kb="$(awk '/MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null || true)"
min_mem_kb=$((3 * 1024 * 1024))
if [[ -z "$mem_kb" || "$mem_kb" -lt "$min_mem_kb" ]]; then
  echo "MemAvailable is ${mem_kb:-unknown}kB, below 3GiB. Stopping this preview before it starts. Other previews were left running." >&2
  exit 2
fi

project="preview-${pr}"
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

# Optional runtime values. Empty values are left untouched. The values are
# not printed.
upsert_env() {
  local key="$1"
  local value="${!key-}"
  if [[ -z "$value" ]]; then
    return 0
  fi
  grep -v "^${key}=" "$env_file" > "${env_file}.tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "${env_file}.tmp"
  mv "${env_file}.tmp" "$env_file"
  chmod 600 "$env_file"
}
for key in \
  WEWEBPLUS_DATABASE_URL \
  WEWEBPLUS_SECRETS_KEY \
  CLERK_PUBLISHABLE_KEY \
  CLERK_SECRET_KEY \
  AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY \
  AWS_REGION
do
  upsert_env "$key"
done

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_API_TOKEN_:-}" ]]; then
  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_"
fi
if [[ -z "${CLOUDFLARE_ZONE_ID:-}" && -n "${CLOUDFLARE_ZONE_ID_:-}" ]]; then
  export CLOUDFLARE_ZONE_ID="$CLOUDFLARE_ZONE_ID_"
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" && -n "${CLOUDFLARE_ACCOUNT_ID_:-}" ]]; then
  export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID_"
fi
missing_tunnel=0
for cloudflare_name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ZONE_ID CLOUDFLARE_ACCOUNT_ID; do
  if [[ -n "${!cloudflare_name:-}" ]]; then
    echo "${cloudflare_name}: present"
  else
    echo "${cloudflare_name}: absent"
    missing_tunnel=1
  fi
done
if [[ "${PREVIEW_REQUIRE_NAMED_TUNNEL:-}" == "1" && "$missing_tunnel" == "1" ]]; then
  echo "Named tunnel credentials are required." >&2
  exit 1
fi

if [[ "${PREVIEW_SKIP_TUNNEL:-}" != "1" || -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
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

bedrock_status="$(
  python3 - "$env_file" << 'PY'
import sys
vals = {}
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.strip() or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    vals[key] = value.strip().strip("'\"")
ok = all(
    vals.get(name)
    for name in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION")
)
print("bedrock_iam=present" if ok else "bedrock_iam=absent")
PY
)"
echo "$bedrock_status"
if [[ "${PREVIEW_REQUIRE_BEDROCK:-}" == "1" && "$bedrock_status" != "bedrock_iam=present" ]]; then
  echo "Bedrock IAM credentials are missing from the preview env file" >&2
  exit 2
fi

echo "Pulling ${image} for ${project}"
"${compose[@]}" pull dyad gc
echo "Starting ${project}"
"${compose[@]}" up -d --wait dyad
echo "Selecting the global Bedrock profile when the saved model is still auto"
cid="$("${compose[@]}" ps -q dyad)"
if [[ -n "$cid" ]]; then
  docker exec -i -u weaver "$cid" python3 - /home/weaver/.config/weaver-plus/user-settings.json --select-bedrock \
    < "$root/scripts/gascity/use_singapore_bedrock_settings.py"
  "${compose[@]}" up -d --force-recreate --wait dyad
fi
gc_state=healthy
if ! "${compose[@]}" up -d --wait gc; then
  gc_state=unhealthy
  echo "gc did not become healthy. The Dyad page still starts." >&2
  docker logs --tail 60 "${project}-gc-1" >&2 || true
fi
"${compose[@]}" up -d --wait gascity
if [[ "$tunnel" -eq 1 ]]; then
  "${compose[@]}" up -d cloudflared
fi
echo "Checking factory API on the preview network"
"${compose[@]}" --profile check run --rm caller
echo "Checking the preview listener"
gate_code=""
for _ in 1 2 3 4 5; do
  gate_code="$(docker exec "${project}-gascity-1" node -e 'fetch("http://127.0.0.1:8787/v1/runs",{method:"POST",headers:{"authorization":"Bearer session-token","content-type":"application/json"},body:JSON.stringify({prompt:"preview gate check",idempotencyKey:"preview-gate-check"})}).then(async (response)=>{process.stdout.write(String(response.status))})')"
  echo "listener ${gate_code}"
  if [[ "$gate_code" == "202" ]]; then
    docker logs "${project}-gascity-1" 2>&1 | grep 'run accepted' | tail -1
    break
  fi
  sleep 3
done
if [[ "$gate_code" != "202" ]]; then
  echo "listener refused the run with HTTP ${gate_code}" >&2
  docker logs "${project}-gascity-1" 2>&1 | grep -E 'run (accepted|refused)' | tail -1 || true
  exit 2
fi
echo "Preview project ${project} is up"
echo "City volume pr-${pr}-city has a city"
echo "https://gc-pr-${pr}.anakwannaphaschaiyong.com"
if [[ "$tunnel" -eq 1 ]]; then
  preview_url="https://pr-${pr}.anakwannaphaschaiyong.com"
else
  echo "Named tunnel credentials are absent. Starting a temporary tunnel."
  "${compose[@]}" --profile quick up -d quick
  preview_url=""
  for _ in $(seq 1 30); do
    preview_url="$(docker logs "${project}-quick-1" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)"
    if [[ -n "$preview_url" ]]; then
      break
    fi
    sleep 2
  done
  if [[ -z "$preview_url" ]]; then
    echo "Temporary tunnel did not report a URL." >&2
    exit 2
  fi
fi
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -sS -o /tmp/preview-body -w '%{http_code}' --max-time 20 "$preview_url" || true)"
  echo "preview http ${code}"
  if [[ "$code" == "200" ]] && grep -q 'data-dyad-browser-bridge' /tmp/preview-body; then
    ok=1
    break
  fi
  sleep 5
done
tunnel_kind=quick
if [[ "$tunnel" -eq 1 ]]; then
  tunnel_kind=named
fi
bridge=no
if [[ "$ok" == "1" ]]; then
  bridge=yes
fi
echo "preview_result pr=${pr} action=up url=${preview_url} http=${code} bridge=${bridge} tunnel=${tunnel_kind} gc=${gc_state}"
if [[ "$ok" != "1" ]]; then
  echo "Preview page did not return the browser bridge." >&2
  exit 1
fi
printf '%s\n' "$preview_url" > "${state_dir}/preview-${pr}.public-url"
chmod 600 "${state_dir}/preview-${pr}.public-url"
echo "preview_url=${preview_url}"
echo "clerk step"
PREVIEW_ORIGIN="$preview_url" node "$root/deploy/preview/clerk-origins-run.mjs"
echo "clerk step done"
