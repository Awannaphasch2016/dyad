# Experiment B log

Branch `cursor/hitl-experiment-b-d072`. Evidence for items 11 and 12 in `plans/hitl-experiments-runbook.md`.

## B1 one approval check

2026-10-09. `npm test -- src/ipc/handlers/factory_host_handlers.test.ts src/main/factory_host_bridge_server.test.ts`: the new approval tests and the existing bridge tests passed.

`requirePhaseApproval` is the `approve-<phase>` check. `factory:approve` and `factory-host:approve-phase` both call it. A developer session on an organization-owned app is `DyadError` Auth (`Your role can't do that.`) on both channels, and no approval row is stored. A project-manager session stores Discovery through the account path and Implementation through the host path.

The bridge `POST /v1/apps/:id/phases/:phase/approve` route still calls `approveFactoryPhase` with the machine token. With Clerk configured and a developer session present, that route still stores Delivery.

## B2 summary necessary, not sufficient

2026-10-09. `npm test -- src/components/chat/FactoryPhaseBar.test.tsx`: 4 tests passed, including `keeps Continue closed for a developer after the summary and open for a project manager`.

After `## Discovery summary`, the developer Continue control is disabled and the bar says the role cannot approve the phase. The project manager's Continue control is enabled. With no summary, the project manager's control is disabled until wewebplus posts the Discovery summary. No second Dyad sign-in was required; the bar reads the signed-in role from the same session context the app already uses.

## B3 loop inside Implementation

2026-10-09. `npm test -- src/main/factory_host_b3.test.ts`: 1 test passed.

The project manager approves Discovery through `factory:approve`. A developer approve of Delivery is refused. The Experiment A fixtures then run in Implementation: the project manager is asked, then the developer, then the run ends on `## Implementation summary`. All three `factoryHostRuns` rows are Implementation. Delivery has no messages, and `isFactoryPhaseUnlocked("delivery")` stays false before the loop, during it, and after the summary. Implementation stays unlocked because Discovery is approved.

## Section 8

2026-10-09. A and B are done, so the decisions those runs can settle are filled in `plans/hitl-experiments-runbook.md` section 8.

A request does not need a bead. The local resume edge stays in the bridge. `resolve_hitl_answer.py` stays for bead-backed gates and was not used here. The `stepId: "question"` relaxation stays; A6 did not need a role outside `project-manager` and `developer`. Both approval paths stay, behind `requirePhaseApproval`.

The Cursor carrier and the Cursor follow-up are not decided.

## P2

2026-10-09. Still blocked. The process environment has no `CURSOR_API_KEY`. Doppler is not installed. The GitHub CLI token is a GitHub token. C1–C4 stay unstarted, because the runbook starts them only after P2.

The diff from `cursor/galan-software-factory-2fff` does not touch `scripts/gascity/`, GasCity, the Neon schema, or Paperclip.
