#!/usr/bin/env bash
# Local checks for the privileged-exec harness. Does not call GitHub or Doppler.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

bash -n scripts/privileged-exec/dispatch.sh
python3 -m py_compile scripts/privileged-exec/doppler_status.py scripts/privileged-exec/host_status.py

python3 - << 'PY'
import importlib.util
import pathlib

def load(name):
    path = pathlib.Path("scripts/privileged-exec") / name
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

status = load("doppler_status.py")
body = {
    "config": {"project": "dyad", "name": "preview"},
    "value": {"computed": "super-secret-value"},
    "token": "dp.st.secret",
}
line = status.config_line("dyad", "preview", 200, body)
if line != "dyad_preview=http-200 project=dyad config=preview":
    raise SystemExit(f"unexpected config line: {line}")
if "super-secret-value" in line or "dp.st.secret" in line:
    raise SystemExit("config line printed a secret")
names = status.name_lines(200, ["CURSOR_API_KEY", "CLERK_SECRET_KEY", "EC2_SSH_KEY"])
text = "\n".join(names)
if "CLERK_SECRET_KEY" in text:
    raise SystemExit("name report printed a name outside the allowlist")
if "CURSOR_API_KEY=present" not in text or "EC2_SSH_KEY=present" not in text:
    raise SystemExit(f"name report missing an allowlisted name: {text}")
print("doppler status lines ok")
PY

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/gh" << 'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_LOG"
if [[ "$1" == "workflow" && "$2" == "run" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat << 'JSON'
[{"databaseId":42,"event":"workflow_dispatch","headBranch":"cursor/privileged-exec-harness-d072","createdAt":"2099-01-01T00:00:00Z","status":"completed","conclusion":"success"}]
JSON
  exit 0
fi
if [[ "$1" == "run" && "$2" == "watch" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "view" && "$*" == *"--jq"* ]]; then
  printf '%s\n' success
  exit 0
fi
if [[ "$1" == "run" && "$2" == "view" && "$*" == *"--log"* ]]; then
  printf '%s\n' \
    'exec	Log in to Doppler by OIDC	2026-10-10T11:44:51.2463688Z echo "doppler_identity=absent"' \
    'exec	Report Doppler status	2026-10-10T11:44:52.4849808Z dyad_preview=http-200 project=dyad config=preview' \
    'exec	Report Doppler status	2026-10-10T11:44:52.4850256Z CURSOR_API_KEY=present' \
    'exec	Report Doppler status	2026-10-10T11:44:52.4850388Z secret=super-secret-value' \
    'exec	Report Doppler status	2026-10-10T11:44:52.4850527Z DOPPLER_TOKEN=dp.st.should-not-print'
  exit 0
fi
if [[ "$1" == "run" && "$2" == "view" ]]; then
  printf '%s\n' '{"conclusion":"success"}'
  exit 0
fi
echo "unexpected gh: $*" >&2
exit 1
EOF
chmod 755 "$tmp/gh"

export PATH="$tmp:$PATH"
export GH_LOG="$tmp/gh.log"
export PRIVILEGED_EXEC_REF="cursor/privileged-exec-harness-d072"
export DOPPLER_TOKEN="dp.st.agent-must-not-send"
export EC2_SSH_KEY="ssh-secret"

set +e
bash scripts/privileged-exec/dispatch.sh 'echo owned' >"$tmp/bad.out" 2>"$tmp/bad.err"
bad_status=$?
set -e
if [[ "$bad_status" -ne 2 ]]; then
  echo "dispatch accepted a shell command (status $bad_status)" >&2
  exit 1
fi
if [[ -s "$tmp/gh.log" ]]; then
  echo "a refused operation still called gh" >&2
  exit 1
fi

bash scripts/privileged-exec/dispatch.sh doppler-status >"$tmp/ok.out"
if ! grep -q 'operation=doppler-status' "$tmp/ok.out"; then
  echo "dispatch did not record the operation" >&2
  exit 1
fi
if ! grep -q 'run_id=42' "$tmp/ok.out"; then
  echo "dispatch did not record the run id" >&2
  exit 1
fi
if ! grep -q 'dyad_preview=http-200 project=dyad config=preview' "$tmp/ok.out"; then
  echo "dispatch dropped the status line" >&2
  exit 1
fi
if grep -q 'super-secret-value\|dp.st.should-not-print\|dp.st.agent-must-not-send\|ssh-secret' "$tmp/ok.out"; then
  echo "dispatch printed a secret" >&2
  exit 1
fi
if ! grep -q -- '-f operation=doppler-status' "$tmp/gh.log"; then
  echo "gh was not asked for the named operation" >&2
  cat "$tmp/gh.log" >&2
  exit 1
fi
if grep -q 'dp.st.agent-must-not-send\|ssh-secret' "$tmp/gh.log"; then
  echo "gh received a secret from the agent" >&2
  exit 1
fi
echo "dispatch allowlist ok"
