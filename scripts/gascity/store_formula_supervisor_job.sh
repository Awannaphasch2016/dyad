#!/usr/bin/env bash
# Create or copy allowlisted GasCity settings into Doppler. Does not print values.
set -euo pipefail
set +x
set +e
python3 scripts/gascity/store_formula_supervisor.py --from-doppler
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  exit 0
fi
if [[ "$status" -ne 3 ]]; then
  exit "$status"
fi
key="$RUNNER_TEMP/gascity-ec2"
python3 scripts/gascity/prepare_ec2_ssh_key.py "$key"
ssh_opts=(
  -i "$key"
  -o UserKnownHostsFile="$GITHUB_WORKSPACE/.github/gascity_known_hosts"
  -o StrictHostKeyChecking=yes
  -o IdentitiesOnly=yes
  -o ConnectTimeout=20
)
remote=/tmp/formula-supervisor-py
set +e
ssh "${ssh_opts[@]}" ubuntu@13.251.216.187 "rm -rf '$remote' && mkdir -p '$remote'"
ssh_status=$?
set -e
if [[ "$ssh_status" -ne 0 ]]; then
  echo "production host ssh unreachable"
  exit 0
fi
scp "${ssh_opts[@]}" \
  scripts/gascity/formula_supervisor_select.py \
  scripts/gascity/read_formula_supervisor_env.py \
  "ubuntu@13.251.216.187:$remote/"
set +e
ssh "${ssh_opts[@]}" ubuntu@13.251.216.187 "python3 '$remote/read_formula_supervisor_env.py'" \
  | tee "$RUNNER_TEMP/formula-supervisor-setup.txt"
read_status=${PIPESTATUS[0]}
set -e
ssh "${ssh_opts[@]}" ubuntu@13.251.216.187 "rm -rf '$remote'" || true
if [[ "$read_status" -ne 0 ]]; then
  exit "$read_status"
fi
secret_file="$(python3 scripts/gascity/store_formula_supervisor.py --secret-file-from-log "$RUNNER_TEMP/formula-supervisor-setup.txt")"
ssh "${ssh_opts[@]}" ubuntu@13.251.216.187 "cat '$secret_file' && rm -f '$secret_file'" \
  > "$RUNNER_TEMP/formula-supervisor.json"
set +e
python3 scripts/gascity/store_formula_supervisor.py --host-env "$RUNNER_TEMP/formula-supervisor.json"
status=$?
set -e
rm -f "$RUNNER_TEMP/formula-supervisor.json" "$key"
if [[ "$status" -eq 3 ]]; then
  echo "supervisor settings are still absent"
  exit 0
fi
exit "$status"
