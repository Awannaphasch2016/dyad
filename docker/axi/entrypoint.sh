#!/usr/bin/env bash
# Repair the agent session hooks when HOME is a mount, then run the command.
# Never touches gh auth; credentials come from GH_TOKEN or a mounted config.
set -Eeuo pipefail

repair_hooks() {
  if [[ -f "$HOME/.claude/settings.json" ]]; then
    return
  fi
  if ! mkdir -p "$HOME/.claude" 2>/dev/null; then
    echo "axi-toolbox: $HOME is not writable; session hooks were not installed" >&2
    return
  fi
  if ! gh-axi setup hooks >/dev/null 2>&1; then
    echo "axi-toolbox: gh-axi setup hooks failed; continuing without session hooks" >&2
    return
  fi
  for dir in "$HOME/.agents/skills" "$HOME/.claude/skills"; do
    mkdir -p "$dir"
    if [[ ! -e "$dir/gh-axi" ]]; then
      ln -s "${AXI_SKILL_DIR:-/opt/axi/lib/node_modules/gh-axi/skills/gh-axi}" "$dir/gh-axi"
    fi
  done
}

repair_hooks
exec "$@"
