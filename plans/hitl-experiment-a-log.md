# Experiment A log

Branch `cursor/hitl-experiment-a-d072`. Evidence for the verification list in `plans/hitl-experiments-runbook.md`.

## P1 baseline

2026-10-09. `npm test -- src/control_plane/hitl.test.ts src/main/factory_host_bridge_hitl.test.ts src/main/factory_host_bridge_server.test.ts`: 12 tests passed.

Baseline, before the steps below: `answerHitlQuestion` returned `resolved: false`; `QuestionBody` required `gateBeadId`; `factoryHost.approvePhase` has no permission check; `factory.approve` requires `approve-<phase>`, which only the project manager holds. A3 and A4 change the first two. The two approval paths are unchanged.

## P3 two sign-ins

2026-10-09. Ran on the Bolt walkthrough with the automated sign-in from PR #91, not two Dyad windows. [PR #98](https://github.com/Awannaphasch2016/dyad/pull/98). Job [37976118225](https://github.com/Awannaphasch2016/dyad/actions/runs/37976118225): 6 passed, including `p3: a project-manager question is visible only to that role`.

The job posted `plan-approve` with the machine token while both roles were signed in on the shared project, phase `implementation`, question `d34c0432-ba45-4a50-b295-a782c2eaf887`. The project manager session received the body and could answer. The developer session received status `open`, a hidden body, and a refused answer (403). The developer page did not show the question text. The same run's on-screen gate showed "Waiting on the Developer." to the project manager and "Approve the Implementation review." to the developer.

The local unit test still covers the same rule in `src/main/factory_host_bridge_hitl.test.ts`.

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

## A6 local loop

2026-10-09. `npm test -- src/main/factory_host_request.test.ts src/main/factory_host_a6.test.ts`: 3 tests passed.

A completed factory run whose reply contains `## Request for project-manager` or `## Request for developer` stores one question with `beadId` null. Opening that run again does not store a second question. A reply that is `## Implementation summary` classifies as `ready-for-approval` and stores nothing. The chat stream calls this when a turn finishes.

`src/main/factory_host_a6.test.ts` drives three local-agent turns through the chat-flow harness and the factory bridge, all in Implementation. The first turn asks the project manager. The project manager's answer starts the second turn, and that prompt contains the answer. The second turn asks the developer. The developer sees the project manager's question as open with the body hidden, and an outsider organization gets 404. The developer's answer starts the third turn, whose reply is the implementation summary. The test sees three `factoryHostRuns` rows and two questions.
