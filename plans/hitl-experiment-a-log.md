# Experiment A log

Branch `cursor/hitl-experiment-a-d072`. Evidence for the verification list in `plans/hitl-experiments-runbook.md`.

## P1 baseline

2026-10-09. `npm test -- src/control_plane/hitl.test.ts src/main/factory_host_bridge_hitl.test.ts src/main/factory_host_bridge_server.test.ts`: 12 tests passed.

Confirmed in code, unchanged by this branch: `answerHitlQuestion` returns `resolved: false`; `QuestionBody` requires `gateBeadId`; `factoryHost.approvePhase` has no permission check; `factory.approve` requires `approve-<phase>`, which only the project manager holds.

## P3 two sign-ins

Not run. It needs two Dyad instances signed in as the project manager and the developer. The same visibility rule is already asserted by `src/main/factory_host_bridge_hitl.test.ts`: the developer sees status only, and an outsider organization sees nothing. A6 still waits on the live check.

## A1 request marker

Parser: `extractFactoryRequest` in `src/lib/factoryRequest.ts`. Five cases in `src/lib/factoryRequest.test.ts`, all passing: present, absent (including a request inside a thinking block), unknown role, last of two wins, code fence ignored.

The three phase prompts tell the agent to write `## Request for project-manager` or `## Request for developer` and stop. Asserted in `src/prompts/factory_phase_prompt.test.ts`.

## A2 stop classification

`classifyFactoryStop` in `src/lib/factoryStop.ts`. One case per row of the status table, plus a request beating a summary, in `src/lib/factoryStop.test.ts`. Local status `completed` counts as finished. A `rejected` run is abandoned, so every status the function accepts returns a class.
