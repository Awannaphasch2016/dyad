#!/usr/bin/env bash
# Checks for the AXI toolbox image. Needs Docker. Does not need a GitHub token
# and does not reach GitHub after the build.
#
# Set AXI_TOOLBOX_IMAGE to test an image that is already built.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# shellcheck source=tools.env
source docker/axi/tools.env

image="${AXI_TOOLBOX_IMAGE:-}"
if [[ -z "$image" ]]; then
  image="axi-toolbox:test"
  docker build \
    --file docker/axi/Dockerfile \
    --build-arg "GH_VERSION=${GH_VERSION}" \
    --build-arg "GH_AXI_VERSION=${GH_AXI_VERSION}" \
    --tag "$image" \
    .
fi

fail() {
  echo "toolbox.test.sh: $*" >&2
  exit 1
}

# No credentials reach these runs, whatever the host has set.
run() {
  docker run --rm \
    -e GH_TOKEN= -e GITHUB_TOKEN= -e GH_CONFIG_DIR=/tmp/no-gh-config \
    "$@"
}

got="$(run "$image" gh-axi --version)"
[[ "$got" == "$GH_AXI_VERSION" ]] || fail "gh-axi --version printed '$got', expected $GH_AXI_VERSION"

got="$(run "$image" gh --version | head -1)"
[[ "$got" == *"gh version ${GH_VERSION} "* ]] || fail "gh --version printed '$got', expected ${GH_VERSION}"

got="$(run "$image" whoami)"
[[ "$got" == "agent" ]] || fail "container runs as '$got', expected agent"

got="$(docker inspect --format '{{.Config.User}}' "$image")"
[[ "$got" == "agent" ]] || fail "image user is '$got', expected agent"

set +e
out="$(run "$image" gh-axi run list --limit 1 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]] || fail "gh-axi run list succeeded without a token"
[[ "$out" == *"AUTH_REQUIRED"* ]] || fail "gh-axi without a token did not report AUTH_REQUIRED: $out"

if docker history --no-trunc --format '{{.CreatedBy}}' "$image" \
  | grep -E 'GH_TOKEN=|GITHUB_TOKEN=|DOPPLER_TOKEN=' >/dev/null; then
  fail "a token name appears in the image history"
fi

run "$image" test -f /home/agent/.claude/settings.json \
  || fail "Claude Code hook file is missing from the image home"
run "$image" grep -q gh-axi /home/agent/.claude/settings.json \
  || fail "Claude Code hook file does not name gh-axi"
run "$image" test -f /home/agent/.codex/hooks.json \
  || fail "Codex hook file is missing from the image home"
run "$image" test -f /home/agent/.agents/skills/gh-axi/SKILL.md \
  || fail "gh-axi skill is not linked into the image home"

# A caller who mounts an empty home still gets the hooks.
tmp="$(mktemp -d)"
# The container writes into the mount as uid 10001, so remove through it.
cleanup() {
  docker run --rm -v "$tmp:/home/agent" --entrypoint sh "$image" \
    -c 'find /home/agent -mindepth 1 -delete' >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
chmod 777 "$tmp"
run -v "$tmp:/home/agent" "$image" true
[[ -f "$tmp/.claude/settings.json" ]] || fail "entrypoint did not repair hooks over a mounted home"
# The link target lives inside the image, so test the link, not the target.
[[ -L "$tmp/.agents/skills/gh-axi" ]] || fail "entrypoint did not link the skill over a mounted home"

run "$image" ops-axi --help >/dev/null || fail "ops-axi --help failed"

got="$(run "$image" sh -c 'echo "$GH_REPO"')"
[[ -n "$got" ]] || fail "GH_REPO default is empty"

echo "toolbox.test.sh: ok ($image)"
