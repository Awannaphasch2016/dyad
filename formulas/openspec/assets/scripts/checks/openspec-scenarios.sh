#!/usr/bin/env bash
# OpenSpec acceptance: every added requirement carries a #### Scenario: heading.
# When the openspec CLI is installed, openspec validate must also pass.

set -euo pipefail

fail() {
  echo "openspec-scenarios: $*" >&2
  exit 1
}

BEAD_ID="${GC_BEAD_ID:-}"
[ -n "$BEAD_ID" ] || fail "GC_BEAD_ID is required"
command -v gc >/dev/null 2>&1 || fail "gc is required on PATH"
command -v jq >/dev/null 2>&1 || fail "jq is required on PATH"

metadata_value() {
  printf '%s' "$1" | jq -r --arg key "$2" '
    (if type == "array" then .[0] else . end) as $bead
    | ($bead.metadata[$key] // "")
    | if type == "string" then . else "" end
  '
}

GC_ERR="$(mktemp)"
trap 'rm -f "$GC_ERR"' EXIT INT TERM HUP
SHOW_JSON="$(gc bd show "$BEAD_ID" --json 2>"$GC_ERR")" \
  || fail "gc bd show $BEAD_ID failed: $(tail -c 400 "$GC_ERR" | tr '\n' ' ')"
ROOT_ID="$(metadata_value "$SHOW_JSON" "gc.root_bead_id")"
[ -n "$ROOT_ID" ] || fail "missing gc.root_bead_id on $BEAD_ID"
ROOT_JSON="$(gc bd show "$ROOT_ID" --json 2>"$GC_ERR")" \
  || fail "gc bd show $ROOT_ID failed: $(tail -c 400 "$GC_ERR" | tr '\n' ' ')"

ARTIFACT=""
for key in gc.var.artifact_root artifact_root gc.build.artifact_root gc.artifact_root; do
  value="$(metadata_value "$ROOT_JSON" "$key")"
  if [ -n "$value" ]; then
    ARTIFACT="$value"
    break
  fi
done
[ -n "$ARTIFACT" ] || fail "workflow root $ROOT_ID has no artifact_root metadata"

case "$ARTIFACT" in
  /*) ;;
  *)
    ROOT_DIR="${GC_RIG_ROOT:-${GC_BEADS_SCOPE_ROOT:-${GC_STORE_PATH:-${GC_WORK_DIR:-}}}}"
    [ -n "$ROOT_DIR" ] || fail "artifact path $ARTIFACT is relative and no rig root is set"
    ARTIFACT="$ROOT_DIR/$ARTIFACT"
    ;;
esac
[ -d "$ARTIFACT" ] || fail "artifact root $ARTIFACT is not a directory"

mapfile -t SPEC_FILES < <(find "$ARTIFACT/specs" -type f -name 'spec.md' 2>/dev/null | sort || true)
[ "${#SPEC_FILES[@]}" -gt 0 ] || fail "no specs/**/spec.md under $ARTIFACT"
MISSING=0
for spec in "${SPEC_FILES[@]}"; do
  if ! grep -q '^#### Scenario:' "$spec"; then
    echo "openspec-scenarios: $spec has no #### Scenario: heading" >&2
    MISSING=1
  fi
done
[ "$MISSING" -eq 0 ] || fail "scenario headings are required on added requirements"

if command -v openspec >/dev/null 2>&1; then
  (cd "$ARTIFACT" && openspec validate --strict) \
    || fail "openspec validate --strict failed in $ARTIFACT"
fi

echo "OpenSpec scenarios accepted"
exit 0
