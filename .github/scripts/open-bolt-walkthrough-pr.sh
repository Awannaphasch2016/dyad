#!/usr/bin/env bash
# Apply the website walkthrough patch to Awannaphasch2016/bolt.diy and open a pull request.
set -euo pipefail

repository="${BOLT_REPOSITORY:?BOLT_REPOSITORY is required}"
branch="${BOLT_BRANCH:?BOLT_BRANCH is required}"
patch_file="${PATCH_FILE:?PATCH_FILE is required}"
base_branch="${BOLT_BASE_BRANCH:-main}"

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is missing." >&2
  exit 1
fi

if [[ ! -s "$patch_file" ]]; then
  echo "Walkthrough patch is missing: $patch_file" >&2
  exit 1
fi

existing="$(gh pr list --repo "$repository" --head "$branch" --base "$base_branch" --state open --json url --jq '.[0].url // empty')"
if [[ -n "$existing" ]]; then
  echo "Pull request already open: $existing"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "Pull request: $existing" >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

gh auth setup-git
git clone --depth 1 "https://github.com/${repository}.git" "$work_dir/bolt"
git -C "$work_dir/bolt" config user.name "dyad-harness[bot]"
git -C "$work_dir/bolt" config user.email "5221649+dyad-harness[bot]@users.noreply.github.com"
git -C "$work_dir/bolt" am "$patch_file"
git -C "$work_dir/bolt" push origin "HEAD:${branch}"

pr_url="$(
  gh pr create \
    --repo "$repository" \
    --base "$base_branch" \
    --head "$branch" \
    --title "Add the Discovery, Implementation, and Delivery walkthrough" \
    --body "$(cat <<'EOF'
Ports the Discovery, Implementation, and Delivery walkthrough into the bolt.diy chat.

- One send stays in flight.
- The next phase unlocks only after that phase's summary.
- The preview appears once Implementation starts.
EOF
)"
)"

echo "Pull request: $pr_url"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  echo "Pull request: $pr_url" >>"$GITHUB_STEP_SUMMARY"
fi
