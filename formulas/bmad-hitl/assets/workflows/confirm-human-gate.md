Ask the human mailbox for one verdict.

This is a blocking human gate: one open confirmation bead, one mail to `human`, and a verdict on the bead. The parent check reads `human_gate.verdict`. It does not read the mail body.

Read these metadata keys from this bead:

- `gc.human_gate.phase` — the phase name to show
- `gc.human_gate.question` — the question to send
- `human_gate.loop_step` — the parent gate id the check filters on

`interaction_mode` does not skip this step. Do not approve the gate yourself. Do not name an organization role. `human` is the only mailbox.

1. If this bead already has `human_gate.verdict` of `approve` or `request-changes`, skip mail and go to the close step. A host such as Dyad may have written that verdict over its own answer path.
2. Otherwise send exactly one mail for this attempt. Skip the send when `human_gate.mail_attempt` already equals this bead's `gc.attempt` (empty attempt counts as attempt `1`).

```bash
gc mail send human \
  -s "$QUESTION" \
  -m "Phase: $PHASE
Bead: $GC_BEAD_ID
Reply with exactly one of: approve, request-changes
A request-changes reply must include the feedback."
```

Do not pass `--notify`. A reply to `human` does not wake a session, and Dyad does not resume through notify. After a successful send, set `human_gate.mail_attempt` to this attempt.

3. Register a session wait so idle cleanup does not recycle this session while the bead is open. The command returns; it is not a timeout. Skip it when this session already has the same note.

```bash
SESSION_TARGET="${GC_SESSION_ID:-${GC_SESSION_NAME:-}}"
SESSION_ATTACH="${GC_SESSION_NAME:-$SESSION_TARGET}"
WAIT_NOTE="Waiting for a human verdict on bead $GC_BEAD_ID."
if [ -n "$SESSION_ATTACH" ]; then
  WAIT_NOTE="$WAIT_NOTE Resume with: gc session attach $SESSION_ATTACH"
fi
if [ -n "$SESSION_TARGET" ] && ! gc wait list --session "$SESSION_TARGET" | grep -Fq "$WAIT_NOTE"; then
  gc session wait "$SESSION_TARGET" \
    --sleep \
    --on-beads "$GC_BEAD_ID" \
    --note "$WAIT_NOTE"
fi
```

4. Do not close this bead until `human_gate.verdict` is `approve` or `request-changes`. Silence is not approval. If the session idles, detaches, or restarts, a resumed worker reads the bead and continues from this gate.
5. Map an explicit reply onto the bead. `approve` sets `human_gate.verdict=approve`. `request-changes` sets `human_gate.verdict=request-changes` and copies the feedback into `human_gate.feedback`. That failed check runs this gate's revision child again.

```bash
gc bd update "$CLAIMED_BEAD_ID" \
  --set-metadata 'gc.outcome=pass' \
  --set-metadata 'human_gate.verdict=approve' \
  --set-metadata "human_gate.loop_step=$LOOP_STEP"
gc bd close "$CLAIMED_BEAD_ID" --reason 'Human gate approved.'
```

For `request-changes`, set `human_gate.verdict=request-changes` and `human_gate.feedback` to the reply text, then close with that reason. Do not pass `--metadata` or `--set-metadata` to `gc bd close`.

Do not invoke provider-native subagents.
