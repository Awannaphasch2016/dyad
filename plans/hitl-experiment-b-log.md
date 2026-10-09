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

2026-10-09. GitHub Actions run [38003629139](https://github.com/Awannaphasch2016/dyad/actions/runs/38003629139) on `.github/workflows/hitl-cursor-probe.yml`. The job fetched Doppler project `dyad` config `preview` and project `aws` config `dev` with `DOPPLER_SERVICE_IDENTITY_ID`. `CURSOR_API_KEY` is present in `dyad/preview`. The log does not contain the token.

`GET /v1/me` returned a user key: `userId` and `userEmail` are present, and the key name is `sdd-coordinator`. It is not a service-account key and the payload has no admin role.

`GET /v1/webhooks`, `GET /v0/webhooks`, and `GET /v0/hooks` each returned 404. No webhook exists on those routes. The v1 docs still say webhooks are coming soon.

A no-repo plan agent (`bc-ef4536d3-9314-4a74-9b67-a051b72cabb0`) was created so the probe did not clone or push a repository. The first run was `run-97f4bbd7-0af8-483f-8c5d-c6c5059787bf` and finished with `pong`. The follow-up was a new run id, `run-24e499a3-50ef-48aa-9e4f-b69c9a42804b`, and finished with `pong-2`. Statuses seen: `CREATING`, `RUNNING`, `FINISHED`. The agent was deleted (`DELETE` 200).

C1–C4 can start.

## C1 Cursor run record

2026-10-09. `npm test -- src/main/factory_host_cursor_run.test.ts`: 3 tests passed.

A Cursor run is a `factory_host_runs` row. `run_id` and `intent_id` are `cursor-run:` plus the Cursor run id. The agent id is `cursor_agent_id`, a nullable column, because follow-ups share one agent id and `intent_id` is unique. Two runs for agent `bc-ef4536d3-9314-4a74-9b67-a051b72cabb0` (`run-97f4bbd7-0af8-483f-8c5d-c6c5059787bf` and `run-24e499a3-50ef-48aa-9e4f-b69c9a42804b`) both read back. Writing the first run id again does not insert a second row. No new table.

`0056_hitl_questions` has no Drizzle snapshot, so `db:generate` first emitted those tables again. The committed `0057_cursor_agent_id.sql` keeps only `ALTER TABLE factory_host_runs ADD cursor_agent_id`. A second `db:generate` reported no schema changes. The snapshot still includes the HITL tables and the new column.

The diff from `cursor/galan-software-factory-2fff` does not touch `scripts/gascity/`, GasCity, the Neon schema, or Paperclip.
