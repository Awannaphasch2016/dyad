Ask the human mailbox for one verdict.

This is a blocking human gate: one open confirmation bead, one mail to `human`, and a verdict on the bead. The parent check reads `human_gate.verdict` and `human_gate.role`. It does not read the mail body. A verdict accepts the gate only when `human_gate.role` equals `gc.human_gate.role`.

Read these metadata keys from this bead:

- `gc.human_gate.phase` — the phase name to show
- `gc.human_gate.role` — the only role that can accept or reject this gate: `project-manager` or `developer`
- `gc.human_gate.question` — the question to send
- `human_gate.loop_step` — the parent gate id the check filters on

`interaction_mode` does not skip this step. Do not approve the gate yourself. Do not invent a role. `human` is the only mailbox.

1. If `gc.human_gate.role` is missing, or is not `project-manager` or `developer`, stop. Do not send mail and do not close this bead.
2. If this bead already has `human_gate.verdict` of `approve` or `request-changes` and `human_gate.role` equals `gc.human_gate.role`, skip mail and go to the close step. A host such as Dyad may have written that pair over its own answer path. Dyad must write both keys from the signed-in membership. A verdict without the matching role is not a reply: do not close.
3. Otherwise send exactly one mail for this attempt. Skip the send when `human_gate.mail_attempt` already equals this bead's `gc.attempt` (empty attempt counts as attempt `1`).

```bash
gc mail send human \
  -s "$QUESTION" \
  -m "Phase: $PHASE
Role: $REQUIRED_ROLE
Bead: $GC_BEAD_ID
Reply with role: $REQUIRED_ROLE
and exactly one of: approve, request-changes
A request-changes reply must include the feedback.
A reply from any other role does not accept this gate."
```

Do not pass `--notify`. A reply to `human` does not wake a session, and Dyad does not resume through notify. After a successful send, set `human_gate.mail_attempt` to this attempt.

4. Register a session wait so idle cleanup does not recycle this session while the bead is open. The command returns; it is not a timeout. Skip it when this session already has the same note.

```bash
SESSION_TARGET="${GC_SESSION_ID:-${GC_SESSION_NAME:-}}"
SESSION_ATTACH="${GC_SESSION_NAME:-$SESSION_TARGET}"
WAIT_NOTE="Waiting for a $REQUIRED_ROLE verdict on bead $GC_BEAD_ID."
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

5. Do not close this bead until `human_gate.verdict` is `approve` or `request-changes` and `human_gate.role` equals `gc.human_gate.role`. Silence is not approval. A reply that omits the role, or names a different role, is not a verdict: do not write `human_gate.verdict` and do not close. If the session idles, detaches, or restarts, a resumed worker reads the bead and continues from this gate.
6. Map an explicit reply from the required role onto the bead. `approve` sets `human_gate.verdict=approve` and `human_gate.role` to that role. `request-changes` sets `human_gate.verdict=request-changes`, `human_gate.role` to that role, and copies the feedback into `human_gate.feedback`. That failed check runs this gate's revision child again.

```bash
gc bd update "$CLAIMED_BEAD_ID" \
  --set-metadata 'gc.outcome=pass' \
  --set-metadata 'human_gate.verdict=approve' \
  --set-metadata "human_gate.role=$REQUIRED_ROLE" \
  --set-metadata "human_gate.loop_step=$LOOP_STEP"
gc bd close "$CLAIMED_BEAD_ID" --reason "Human gate approved by $REQUIRED_ROLE."
```

For `request-changes`, set `human_gate.verdict=request-changes`, `human_gate.role` to the required role, and `human_gate.feedback` to the reply text, then close with that reason. Do not pass `--metadata` or `--set-metadata` to `gc bd close`.

Do not invoke provider-native subagents.
