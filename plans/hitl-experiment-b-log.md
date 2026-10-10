# Experiment B log

Branch `cursor/hitl-experiment-b-d072`. Scaffolding evidence for the approval paths and the locked Delivery fixture. The app run in `plans/hitl-experiments-runbook.md` is the proof and is still open.

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

2026-10-09. A and B's bridge findings are kept in `plans/hitl-experiments-runbook.md` under "What the scaffolding already established." They are not the app run.

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

## C2–C4 Cursor loop

2026-10-10. GitHub Actions run [38007957688](https://github.com/Awannaphasch2016/dyad/actions/runs/38007957688) on `.github/workflows/hitl-cursor-factory.yml`. The job fetched Doppler `dyad/preview` and `aws/dev`, then ran `src/main/factory_host_cursor_live.test.ts` with `HITL_CURSOR_LIVE=1`. The log does not contain the token. The agent create body has no `env` block (`agent_env_has_token=false`). The poller alone called the API.

The question store is the factory bridge started in that job, with the machine token. It is not a desktop Dyad window. The project-manager caller saw the question body. The developer caller saw status only (`dev_body=absent`, HTTP 200).

Agent `bc-b1b5f8c7-d484-4eaa-a0d1-3a69d396019e`. No repository, plan mode, `autoCreatePR: false`. Deleted at the end (`DELETE` 200).

| n | marker | status | polls | role | stop | run id |
| - | ------ | ------ | ----- | ---- | ---- | ------ |
| 1 | present | FINISHED | 3 | project-manager | human-required | `run-b227bec7-aa95-418d-ae3b-f1c1bb7c1267` |
| 2 | present | FINISHED | 2 | developer | human-required | `run-a7ddd23a-a62b-4ca0-abe6-1b39566535a0` |
| 3 | absent | FINISHED | 4 | none | ready-for-approval | `run-205d0218-d5db-4ff2-99aa-53969493c3c3` |

Question `16a4462f-814c-41c1-b535-5ac3c06c8302` is the project-manager request. The answer was `Tiny Bakery`. The follow-up was a new run id on the same agent and wrote `## Request for developer`. Question `17c7f0ca-ea39-4c6a-82a2-3351dc177423` is that request. The developer answer was `Use Source Serif for the headings.` The next follow-up was another new run id and classified as `ready-for-approval` (`## Implementation summary`, no request marker).

Both request runs wrote the marker. The summary run did not. Follow-ups produced new run ids, matching P2. `classifyCursorFactoryStop` is the A2 entry point the poller called.

### Second pass

2026-10-10. [Run 38027897774](https://github.com/Awannaphasch2016/dyad/actions/runs/38027897774) is the same job again. It passed. The token was still only in the poller (`agent_env_has_token=false`). The agent was `bc-c0322d61-2ba4-47ae-b348-0434643dfda2` and was deleted (`DELETE` 200).

| n | marker | status | polls | role | stop | run id |
| - | ------ | ------ | ----- | ---- | ---- | ------ |
| 1 | present | FINISHED | 3 | project-manager | human-required | `run-84b0c86c-51b3-466a-8f88-68d8e564f467` |
| 2 | present | FINISHED | 3 | developer | human-required | `run-d31a3328-d419-4e59-97d1-37839ae088e1` |
| 3 | absent | FINISHED | 3 | none | ready-for-approval | `run-7412ddd5-57fe-48b8-bd5e-33fd0f456f38` |

Question `2e33b30a-34d9-4286-8e4a-c039fb6d908d` is the project-manager request. The project-manager caller saw the body and the developer caller did not. Question `439b5770-97e6-4dac-99cb-47b2e0adbe08` is the developer request. The developer caller saw that body and the project-manager caller did not. Both follow-ups were new run ids on the same agent. Both request runs wrote the marker again (0 missing of 2). The third run was the implementation summary.

## Section 8 after C4

The Cursor carrier is the request marker, read by the poller. The token is not placed in the agent environment. The resume edge stays in the bridge: a `cursor-run:` answer sends a follow-up through the registered sender and does not start a local chat. C2 did not need a role outside `project-manager` and `developer`.

The diff from `cursor/galan-software-factory-2fff` does not touch `scripts/gascity/`, GasCity, the Neon schema, or Paperclip.

## Desktop path

2026-10-10. The phase bar now calls `factory:ensure-cursor-phase` for Discovery, for Implementation when the project manager approves Discovery, and for Delivery. The desktop poller writes a summary into the phase chat and a request into the question list. `answerQuestion` passes the follow-up sender. Tests: `src/main/cursor_factory_host.test.ts`, `src/components/chat/FactoryPhaseBar.test.tsx`.

The two signed-in windows have not been run. This environment has no `CURSOR_API_KEY` and no two Clerk sessions, so steps 1–9 of the revised plan are still open.
