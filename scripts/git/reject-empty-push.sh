#!/bin/sh
# Refuse a push that introduces an empty commit.
# An empty commit has one parent and the same tree as that parent.
# A branch deletion, a merge, and a commit that changes files are allowed.
# Commits already reachable from another remote-tracking ref are not new.
set -u

is_zero() {
  case "$1" in
    "" | *[!0]*)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

parent_count() {
  # rev-list --parents prints: commit parent...
  set -- $(git rev-list --parents -n 1 "$1")
  shift
  echo "$#"
}

while read -r local_ref local_sha remote_ref remote_sha; do
  if is_zero "$local_sha"; then
    continue
  fi
  if is_zero "$remote_sha"; then
    commits=$(git rev-list "$local_sha" --not --remotes) || exit 1
  else
    commits=$(git rev-list "$local_sha" --not "$remote_sha") || exit 1
  fi
  for commit in $commits; do
    count=$(parent_count "$commit") || exit 1
    if [ "$count" -ne 1 ]; then
      continue
    fi
    parent=$(git rev-parse "${commit}^") || exit 1
    tree=$(git rev-parse "${commit}^{tree}") || exit 1
    parent_tree=$(git rev-parse "${parent}^{tree}") || exit 1
    if [ "$tree" = "$parent_tree" ]; then
      echo "Refusing to push empty commit ${commit} (${local_ref})" >&2
      exit 1
    fi
  done
done

exit 0
