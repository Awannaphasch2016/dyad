# Integrate multi-tenant HITL with Gas City

Dyad already decides who may see a gate and who may answer it. Gas City does not yet open those gates or continue after the answer. This plan connects the existing question store to the rig `multi tenant HITL`. It does not add a second approval system.

## What Dyad does today

Three step ids are gates. `plan-approve` and `review-approve-pm` require the Project Manager. `review-approve-dev` requires the Developer. Any other step id is rejected.

A question belongs to the organization that owns the app. The host bridge copies that organization from the app. The posted JSON does not name an organization.

Someone in another organization gets no question. Someone in the same organization with the other role sees "Waiting on …" and the status, and does not see the question text or the answer box. The matching role sees the text and can submit while the question is open. A second submit does not store a second answer.

Gas City opens a question with `scripts/gascity/post_hitl_question.py`. That posts to the host bridge `POST /v1/apps/<appId>/phases/<phase>/questions` with the machine token. The same idempotency key returns the existing question.

The person answers in the phase chat. Dyad writes the answer on the device and mirrors it to `wewebplus.questions` and `wewebplus.answers`. The answer call returns `resolved: false`. Dyad does not run `hitl.py` and does not continue the recipe.

`scripts/gascity/resolve_hitl_answer.py` is the closer. It selects answers whose `gate_resolved_at` is empty and whose question has a run id, a step id, and an answered-by name. For each one it runs `hitl.py respond` and then `hitl.py release` on the rig `multi tenant HITL`. It sets `gate_resolved_at` only after both commands exit 0. Nothing in this repository starts that script.

## Example

Two organizations. Wewebplus owns the app Maple Street Books. Harbor is a second organization and owns a different app. One Gas City run, `run-maple-1`, builds Maple Street Books on the rig `multi tenant HITL`.

After Discovery, Gas City posts this question and waits:

```json
{
  "appId": 4,
  "phase": "discovery",
  "runId": "run-maple-1",
  "stepId": "plan-approve",
  "targetRoleId": "project-manager",
  "idempotencyKey": "run-maple-1:plan-approve",
  "gateBeadId": "maple-plan",
  "body": "Approve the Discovery plan for Maple Street Books.\n\n- Page name: Maple Street Books\n- One sentence: A one-page site for a neighborhood bookshop that is open Tuesday through Sunday.\n- Page contents: a title, a short welcome, today's hours, and three featured books with a price under each.\n\nReply approve to start Implementation."
}
```

The Wewebplus Project Manager opens Discovery, sees that text, and submits `approve`. The Wewebplus Developer, on the same app, sees "Waiting on Project Manager for plan-approve. Status: open." and no text and no answer box. A Project Manager at Harbor does not see the question on Harbor's app, and opening Maple Street Books is not found.

Dyad stores one answer. Posting the same key again returns the same question. Submitting again does not store another answer. The answer response still says the gate is not closed.

The closer then runs, with `RIG` left as `multi tenant HITL`:

```text
hitl.py respond --as "<Project Manager display name>" --step plan-approve --run run-maple-1
hitl.py release --run run-maple-1
```

Both exit 0. `gate_resolved_at` is set on that answer. Gas City leaves the gate and builds the page.

The same shape repeats twice:

- On Implementation, step `review-approve-dev`, role `developer`. Only the Wewebplus Developer sees the review text and can submit. The Project Manager sees the waiting line.
- On Delivery, step `review-approve-pm`, role `project-manager`. Only the Wewebplus Project Manager can submit.

Harbor's own open question, if Harbor has one, stays open. Stamping Maple Street's three answers does not release Harbor's run.

That is a successful multi-tenant HITL run: three gates, each answered by the named role in the owning organization, each released on the Maple Street run, and the other organization untouched.

## What to connect

The formula on the rig `multi tenant HITL` stops at three beads. Their step ids are `plan-approve`, `review-approve-dev`, and `review-approve-pm`. The phases are Discovery, Implementation, and Delivery, in that order.

At each bead, Gas City calls `post_hitl_question.py` with the fields in the example. `targetRoleId` matches the step. `idempotencyKey` is `<runId>:<stepId>`. `appId` is the Dyad app owned by the organization. The recipe waits on that bead. A finished model summary and a preview do not release it.

On the host where `hitl.py` already runs, run `resolve_hitl_answer.py` every few seconds. The environment is `WEWEBPLUS_DATABASE_URL`, `HITL_PY`, and the default rig `multi tenant HITL`. The script is not started by Electron and not started by the HITL page.

`hitl.py release` is what lets the formula take the next agent step. Dyad keeps returning `resolved: false`. If `respond` or `release` fails, `gate_resolved_at` stays empty and the next pass tries again.

## Out of scope

The page and Electron do not shell out to `bd` or `hitl.py`. The iPhone preview stays as it is. This plan does not add a second question store.

## Done when

The checks below are true for one Maple Street Books run and one untouched Harbor question.

## Checks

1. Gas City posts one `plan-approve` question for Maple Street Books, owned by Wewebplus.
2. The Wewebplus Project Manager sees the plan text and can submit. The Wewebplus Developer sees only the waiting line. Harbor does not see the question.
3. One submit stores one answer. A second submit does not store another. The response still says the gate is not closed.
4. The closer runs `hitl.py respond` and then `hitl.py release` on rig `multi tenant HITL`, and only then sets `gate_resolved_at`.
5. If either command fails, `gate_resolved_at` stays empty and Gas City stays on that gate.
6. After release, Gas City posts `review-approve-dev`. Only the Wewebplus Developer can answer it.
7. After that release, Gas City posts `review-approve-pm`. Only the Wewebplus Project Manager can answer it.
8. Harbor's open question is still open after Maple Street's three answers are stamped.
