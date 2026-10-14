# HumanGate mechanism

Decision for every later methodology-pack variation. This note does not revise those variations.

## Selection

A blocking human gate is one open confirmation bead, one mail to the `human` mailbox, and a check that reads a verdict on that bead.

| Piece | Role |
| --- | --- |
| Open confirmation bead | Holds the dependent step until a verdict closes it. Later steps that `needs` it stay blocked. |
| `gc mail send human` | Carries the question, the bead id, and the allowed replies. Sent once. |
| Verdict plus check script | `approve` closes the step. `request-changes` runs the producing step again. The script reads the verdict, not the mail body. |
| `gc mail reply --notify` | Wakes a Gas City session that is not running, or injects a mail notice into one that is. Used only when the waiter is a Gas City session. |
| Dyad HTTP answer | Wakes a Dyad run. Writes the same verdict. Does not go through `--notify`. |

`gc session wait --sleep --on-beads` is used when that Gas City session should do no other work while the bead is open. It is optional. Leaving it off lets other sessions, and any step that does not depend on the bead, continue.

Non-blocking steering is mail without an open bead. The sender keeps working. A later turn reads the reply.

## Why this one

Mail alone can send and queue a message. It does not keep a step incomplete, tie an answer to that step, or apply an acceptance rule. A reply wakes a computation only when someone passes `--notify` and the recipient is a Gas City session. A reply to `human` does not wake anything. Unread mail does not wake anything. Notify does not restore a Dyad or Cursor conversation.

The formula field `[steps.gate]` with type `human` creates a bead and nothing watches it. No bundled formula uses it. Building a second gate type would repeat the open bead we already have.

Role routing stays outside the gate. `human` is one mailbox. A later router chooses the person.

## What the next plan must use

Methodology-native packs, Gas City-orchestrated packs, and a Discovery → Implementation → Delivery adaptation all use this gate. They differ in where the confirmation bead is placed. They do not differ in how a person answers.
