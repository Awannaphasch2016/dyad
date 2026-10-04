# Merge Cloudflare names into controller.env. Values are not printed.

normalize_cloudflare_aliases() {
  if [[ -z "${CLOUDFLARE_API_TOKEN_:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    export CLOUDFLARE_API_TOKEN_="$CLOUDFLARE_API_TOKEN"
  fi
  if [[ -z "${CLOUDFLARE_ZONE_ID_:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
    export CLOUDFLARE_ZONE_ID_="$CLOUDFLARE_ZONE_ID"
  fi
  if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" && -n "${CLOUDFLARE_ACCOUNT_ID_:-}" ]]; then
    export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID_"
  fi
}

load_controller_cloudflare() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  echo "controller cloudflare keys:"
  awk -F= '/^CLOUDFLARE/ { print $1 }' "$file"
  local saved_token="${CLOUDFLARE_API_TOKEN_:-}"
  local saved_token_alias="${CLOUDFLARE_API_TOKEN:-}"
  local saved_zone="${CLOUDFLARE_ZONE_ID_:-}"
  local saved_zone_alias="${CLOUDFLARE_ZONE_ID:-}"
  local saved_account="${CLOUDFLARE_ACCOUNT_ID:-}"
  local saved_account_alias="${CLOUDFLARE_ACCOUNT_ID_:-}"
  if [[ -z "${saved_token}${saved_token_alias}" || -z "${saved_zone}${saved_zone_alias}" || -z "${saved_account}${saved_account_alias}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
    [[ -n "$saved_token" ]] && export CLOUDFLARE_API_TOKEN_="$saved_token"
    [[ -n "$saved_token_alias" ]] && export CLOUDFLARE_API_TOKEN="$saved_token_alias"
    [[ -n "$saved_zone" ]] && export CLOUDFLARE_ZONE_ID_="$saved_zone"
    [[ -n "$saved_zone_alias" ]] && export CLOUDFLARE_ZONE_ID="$saved_zone_alias"
    [[ -n "$saved_account" ]] && export CLOUDFLARE_ACCOUNT_ID="$saved_account"
    [[ -n "$saved_account_alias" ]] && export CLOUDFLARE_ACCOUNT_ID_="$saved_account_alias"
  fi
}

upsert_controller_cloudflare() {
  local file="$1"
  local key value tmp
  mkdir -p "$(dirname "$file")"
  [[ -f "$file" ]] || : > "$file"
  chmod 600 "$file"
  for key in CLOUDFLARE_API_TOKEN_ CLOUDFLARE_ZONE_ID_ CLOUDFLARE_ACCOUNT_ID; do
    value="${!key-}"
    if [[ -z "$value" ]]; then
      echo "${key}: absent"
      continue
    fi
    if [[ "$value" == *$'\n'* ]]; then
      echo "Refusing to store ${key}" >&2
      return 2
    fi
    echo "${key}: present"
    tmp="${file}.tmp"
    grep -v "^${key}=" "$file" > "$tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    mv "$tmp" "$file"
    chmod 600 "$file"
  done
}

require_controller_cloudflare() {
  local missing=0
  local key
  for key in CLOUDFLARE_API_TOKEN_ CLOUDFLARE_ZONE_ID_ CLOUDFLARE_ACCOUNT_ID; do
    if [[ -z "${!key-}" ]]; then
      echo "Missing ${key}" >&2
      missing=1
    fi
  done
  [[ "$missing" -eq 0 ]]
}
