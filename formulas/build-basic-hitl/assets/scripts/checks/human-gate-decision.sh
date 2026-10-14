#!/usr/bin/env bash
# Decide whether a human-gate reply accepts the gate.
# Usage: human-gate-decision.sh REQUIRED_ROLE VERDICT REPLY_ROLE
# Exit 0 only when the verdict accepts and the reply role is the required role.

set -euo pipefail

required="${1:-}"
verdict="${2:-}"
reply="${3:-}"

case "$required" in
  project-manager|developer) ;;
  *)
    echo "Human gate has no required role" >&2
    exit 1
    ;;
esac

case "$verdict" in
  approve|approved|done|pass)
    if [ "$reply" != "$required" ]; then
      echo "Human gate reply is not from $required" >&2
      exit 1
    fi
    echo "Human gate approved by $reply"
    exit 0
    ;;
  request-changes|iterate|fail|retry|"")
    if [ -n "$verdict" ] && [ "$reply" != "$required" ]; then
      echo "Human gate reply is not from $required" >&2
      exit 1
    fi
    echo "Human gate needs another pass" >&2
    exit 1
    ;;
  *)
    echo "Unknown human-gate verdict: $verdict" >&2
    exit 1
    ;;
esac
