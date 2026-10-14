#!/usr/bin/env bash
# Accept a human gate when the confirmation bead's human_gate.verdict is approve.
# request-changes, or a missing verdict, fails the check so the gate's children run again.

set -euo pipefail

gmol() { # root_id -> molecule-member JSON array
  # gc ready is the federating reader across city, rig, and graph stores.
  # A failed leg must fail the check. An empty leg would hide a verdict.
  local root="$1" tmp st rc=0
  tmp="$(mktemp -d)" || return 1
  for st in open in_progress blocked closed; do
    { gc ready --metadata-field "gc.root_bead_id=$root" --status "$st" --limit 0 --json \
      >"$tmp/$st.json" || printf '%s\n' "$st" >>"$tmp/failed"; } &
  done
  wait
  if [ -s "$tmp/failed" ]; then
    echo "gmol: gc ready failed for status: $(tr '\n' ' ' <"$tmp/failed")" >&2
    rc=1
  fi
  jq -s 'map(select(type=="array")) | add // [] | unique_by(.id) | sort_by(.updated_at // "")' "$tmp"/*.json || rc=1
  rm -rf "$tmp"
  return "$rc"
}

BEAD_ID="${GC_BEAD_ID:-}"
if [ -z "$BEAD_ID" ]; then
  echo "ERROR: GC_BEAD_ID not set" >&2
  exit 1
fi

GC_ERR="$(mktemp)"
trap 'rm -f "$GC_ERR"' EXIT INT TERM HUP
BEAD_JSON=$(gc bd show "$BEAD_ID" --json 2>"$GC_ERR") || {
  echo "ERROR: gc bd show $BEAD_ID failed: $(tail -c 400 "$GC_ERR" | tr '\n' ' ')" >&2
  exit 1
}

ROOT_ID=$(printf '%s\n' "$BEAD_JSON" | jq -r 'if type == "array" then (.[0].metadata["gc.root_bead_id"] // "") else (.metadata["gc.root_bead_id"] // "") end')
ATTEMPT=$(printf '%s\n' "$BEAD_JSON" | jq -r 'if type == "array" then (.[0].metadata["gc.attempt"] // "") else (.metadata["gc.attempt"] // "") end')
STEP_ID=$(printf '%s\n' "$BEAD_JSON" | jq -r 'if type == "array" then (.[0].metadata["gc.step_id"] // .[0].metadata["human_gate.loop_step"] // "") else (.metadata["gc.step_id"] // .metadata["human_gate.loop_step"] // "") end')
if [ -z "$ROOT_ID" ]; then
  echo "ERROR: missing gc.root_bead_id on $BEAD_ID" >&2
  exit 1
fi

VERDICT=$(
  gmol "$ROOT_ID" |
    jq -r --arg root "$ROOT_ID" --arg attempt "$ATTEMPT" --arg step "$STEP_ID" '
      [
        .[]
        | select(.metadata["gc.root_bead_id"] == $root)
        | select(($attempt == "") or ((.metadata["gc.attempt"] // "") == $attempt))
        | select(
            (($step != "") and ((.metadata["human_gate.loop_step"] // "") == $step))
            or (($step != "") and ((.metadata["gc.ralph_step_id"] // "") == $step))
            or (($step != "") and (((.metadata["gc.scope_ref"] // "") | startswith($step + ".iteration."))))
          )
        | {
            attempt: ((.metadata["gc.attempt"] // "0") | tonumber? // 0),
            updated_at: (.updated_at // ""),
            verdict: (.metadata["human_gate.verdict"] // "")
          }
        | select(.verdict != "")
      ] | sort_by(.attempt, .updated_at) | last.verdict // ""
    '
)

case "$VERDICT" in
  approve|approved|done|pass)
    echo "Human gate approved"
    exit 0
    ;;
  request-changes|iterate|fail|retry|"")
    echo "Human gate needs another pass"
    exit 1
    ;;
  *)
    echo "Unknown human-gate verdict: $VERDICT" >&2
    exit 1
    ;;
esac
