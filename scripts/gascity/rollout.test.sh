#!/usr/bin/env bash
# Local checks for the rollout helpers. Does not talk to EC2 or Doppler.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

bash -n scripts/gascity/rollout.sh
bash -n scripts/gascity/host-wrapper.sh

set +e
bash scripts/gascity/rollout.sh 'not-a-sha'
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "rollout.sh accepted a non-hex commit (status $status)" >&2
  exit 1
fi

set +e
bash scripts/gascity/host-wrapper.sh 'not-a-sha'
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "host-wrapper.sh accepted a non-hex commit (status $status)" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/secrets.json" << 'EOF'
{
  "NOVNC_PASSWORD": "desktop-secret",
  "GAS_CITY_HOST_BRIDGE_TOKEN": "bridge-secret",
  "CLERK_PUBLISHABLE_KEY": "pk_test",
  "CLERK_SECRET_KEY": "sk_test",
  "WEWEBPLUS_DATABASE_URL": "postgres://example",
  "WEWEBPLUS_SECRETS_KEY": "secrets-key",
  "EC2_SSH_KEY": "should-not-be-copied",
  "VERCEL_TOKEN": "should-not-be-copied"
}
EOF
python3 scripts/gascity/write_rollout_env.py "$tmp/rollout.env" < "$tmp/secrets.json"
python3 - "$tmp/rollout.env" << 'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read()
required = [
    "NOVNC_PASSWORD=",
    "GAS_CITY_HOST_BRIDGE_TOKEN=",
    "CLERK_SECRET_KEY=",
    "DYAD_BROWSER_BRIDGE=1\n",
    "DYAD_BROWSER_BRIDGE_PORT=8373\n",
    "WEAVER_PROJECTS_DIR=/opt/gascity/projects\n",
    "NOVNC_PORT=6080\n",
    "GAS_CITY_HOST_BRIDGE_ENABLED=true\n",
    "GAS_CITY_HOST_BRIDGE_PORT=32100\n",
]
missing = [item for item in required if item not in text]
if missing:
    raise SystemExit("env file missing " + ", ".join(missing))
if "EC2_SSH_KEY" in text or "VERCEL_TOKEN" in text or "should-not-be-copied" in text:
    raise SystemExit("env file kept a secret that compose does not use")
print("env allowlist ok")
PY

set +e
printf '%s\n' '{"NOVNC_PASSWORD":""}' | python3 scripts/gascity/write_rollout_env.py "$tmp/missing.env"
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  echo "write_rollout_env.py accepted an empty secret (status $status)" >&2
  exit 1
fi

EC2_SSH_KEY='line-one\nline-two' python3 scripts/gascity/write_ssh_key.py "$tmp/key"
python3 - "$tmp/key" << 'PY'
import os, stat, sys
path = sys.argv[1]
mode = stat.S_IMODE(os.stat(path).st_mode)
text = open(path, encoding="utf-8").read()
if mode != 0o600:
    raise SystemExit(f"ssh key mode is {oct(mode)}")
if text != "line-one\nline-two\n":
    raise SystemExit("escaped newlines were not expanded")
print("ssh key file ok")
PY
rm -f "$tmp/key"
set +e
env -u EC2_SSH_KEY python3 scripts/gascity/write_ssh_key.py "$tmp/missing-key"
status=$?
set -e
if [[ "$status" -ne 1 ]]; then
  echo "write_ssh_key.py accepted an empty key (status $status)" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  set +e
  env -u CLERK_SECRET_KEY node --input-type=module - < scripts/gascity/verify_bridge.mjs > "$tmp/verify.out" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "verify_bridge.mjs ran without CLERK_SECRET_KEY" >&2
    exit 1
  fi
  if ! grep -q "CLERK_SECRET_KEY is empty" "$tmp/verify.out"; then
    echo "verify_bridge.mjs did not report an empty Clerk secret" >&2
    exit 1
  fi
fi

echo "rollout helpers ok"
