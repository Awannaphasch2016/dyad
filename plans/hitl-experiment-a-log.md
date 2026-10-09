# Experiment A log

Branch `cursor/hitl-experiment-a-d072`. Evidence for the verification list in `plans/hitl-experiments-runbook.md`.

## P1 baseline

2026-10-09. `npm test -- src/control_plane/hitl.test.ts src/main/factory_host_bridge_hitl.test.ts src/main/factory_host_bridge_server.test.ts`: 12 tests passed.

Baseline, before the steps below: `answerHitlQuestion` returned `resolved: false`; `QuestionBody` required `gateBeadId`; `factoryHost.approvePhase` has no permission check; `factory.approve` requires `approve-<phase>`, which only the project manager holds. A3 and A4 change the first two. The two approval paths are unchanged.

## P3 two sign-ins

Not run. It needs two Dyad instances signed in as the project manager and the developer. The same visibility rule is already asserted by `src/main/factory_host_bridge_hitl.test.ts`: the developer sees status only, and an outsider organization sees nothing. A6 still waits on the live check.

## A1 request marker

Parser: `extractFactoryRequest` in `src/lib/factoryRequest.ts`. Five cases in `src/lib/factoryRequest.test.ts`, all passing: present, absent (including a request inside a thinking block), unknown role, last of two wins, code fence ignored.

The three phase prompts tell the agent to write `## Request for project-manager` or `## Request for developer` and stop. Asserted in `src/prompts/factory_phase_prompt.test.ts`.

## A2 stop classification

`classifyFactoryStop` in `src/lib/factoryStop.ts`. One case per row of the status table, plus a request beating a summary, in `src/lib/factoryStop.test.ts`. Local status `completed` counts as finished. A `rejected` run is abandoned, so every status the function accepts returns a class.

## A3 request without a bead

`roleForQuestionStep` keeps `plan-approve` on the project manager and accepts `stepId: "question"` for the developer. The bridge no longer requires `gateBeadId`. `src/main/factory_host_bridge_hitl.test.ts` stores that question with `beadId` null and still returns 400 when `plan-approve` names the developer.

## A4 resume from an answer

Answering a question whose `runId` is a local factory run starts one follow-up. The prompt contains the question and the answer. The idempotency key is `<question id>:resume`. A second answer does not start another run. `resolved` is true only when that follow-up was accepted. A question with no local run, including the existing gate test, still returns `resolved: false`. The follow-up does not require the app to be linked to GasCity. Asserted by "starts one resume run from an answer and ignores a second answer".

## A5 restart

`resumeAnsweredFactoryQuestions` runs when the factory bridge starts. An answer whose follow-up dispatch threw is started once on the next call, and a second call does not start another. Asserted by "resumes one accepted run after the dispatch crashes". The bridge still listens when the database is not initialized yet.
