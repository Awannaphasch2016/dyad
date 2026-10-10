#!/usr/bin/env bash
# Ask GitHub Actions to run one named privileged operation.
# This process does not read Doppler, does not accept a shell command, and
# prints only allowlisted status lines from the run log.
set -euo pipefail

repo="${GITHUB_REPOSITORY:-Awannaphasch2016/dyad}"
ref="${PRIVILEGED_EXEC_REF:-}"
if [[ -z "$ref" ]]; then
  ref="$(git rev-parse --abbrev-ref HEAD)"
fi

usage() {
  echo "usage: dispatch.sh doppler-status|host-status" >&2
  exit 2
}

if [[ $# -ne 1 ]]; then
  usage
fi

operation="$1"
case "$operation" in
  doppler-status | host-status) ;;
  *) usage ;;
esac

# A token in this shell is not an input. Drop it so a later command cannot
# echo the environment by accident.
unset DOPPLER_TOKEN EC2_SSH_KEY || true

echo "operation=${operation}"
echo "dispatch_ref=${ref}"

# Record the clock before the request. The run's createdAt is during the
# request, so a timestamp taken afterwards can miss it.
started="$(date -u -d '30 seconds ago' +%Y-%m-%dT%H:%M:%SZ)"

if ! gh workflow run privileged-exec.yml --repo "$repo" --ref "$ref" -f "operation=${operation}"; then
  echo "dispatch=failed operation=${operation}"
  echo "GitHub did not accept the dispatch. The agent token needs actions:write. It does not need Doppler." >&2
  exit 1
fi
echo "dispatch=accepted operation=${operation}"

run_id=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  json="$(gh run list --repo "$repo" --workflow privileged-exec.yml --limit 20 \
    --json databaseId,event,headBranch,createdAt,status)"
  run_id="$(printf '%s' "$json" | jq -r --arg ref "$ref" --arg started "$started" '
    [ .[]
      | select(.event == "workflow_dispatch" and .headBranch == $ref and .createdAt >= $started)
    ]
    | sort_by(.createdAt)
    | last
    | .databaseId // empty
  ')"
  if [[ -n "$run_id" ]]; then
    break
  fi
  sleep 3
done

if [[ -z "$run_id" ]]; then
  echo "dispatch=accepted-run-not-listed operation=${operation}"
  exit 1
fi
echo "run_id=${run_id}"

if ! gh run watch "$run_id" --repo "$repo" --exit-status >/dev/null; then
  conclusion="$(gh run view "$run_id" --repo "$repo" --json conclusion --jq '.conclusion // "unknown"')"
  echo "run_conclusion=${conclusion}"
else
  echo "run_conclusion=success"
fi

gh run view "$run_id" --repo "$repo" --log 2>/dev/null | grep -E \
  '(doppler_identity|github_oidc|doppler_oidc|doppler_oidc_message|doppler_token|dyad_preview|aws_dev|secret_names|CURSOR_API_KEY|EC2_SSH_KEY|forwarded_token|aws_token_via_forwarded|host_doppler|ec2_ssh|ec2_ssh_key_source|github_ec2_ssh_key|ec2_ssh_key_fetch|operation)=' \
  | sed -E 's/.*((doppler_identity|github_oidc|doppler_oidc|doppler_oidc_message|doppler_token|dyad_preview|aws_dev|secret_names|CURSOR_API_KEY|EC2_SSH_KEY|forwarded_token|aws_token_via_forwarded|host_doppler|ec2_ssh|ec2_ssh_key_source|github_ec2_ssh_key|ec2_ssh_key_fetch|operation)=.*)/\1/' \
  || true

conclusion="$(gh run view "$run_id" --repo "$repo" --json conclusion --jq '.conclusion // "unknown"')"
if [[ "$conclusion" != "success" ]]; then
  exit 1
fi
