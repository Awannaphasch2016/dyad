# One pass of the shipped Dyad app

Revised plan for the HITL work in `plans/hitl-workflow-semantics.md`. The scaffolding already on this branch is recorded at the bottom. It is not the proof.

## Important points

1. The proof is one run of the Dyad window, from Discovery through Delivery, with two signed-in roles on one app.
2. A step test, a GitHub Action, or a component preview can support that run. None of them replaces it.
3. Questions show up in `FactoryPhaseBar` when the run stops, body and answer form only for the target role.
4. The answer is typed in that window. The same agent continues, with the answer in the next prompt. Until the answer, the run stays stopped.
5. Continue moves to the next phase only after the summary exists and the project manager approves. The developer cannot approve. Delivery stays locked until Implementation is approved.
6. The run starts at Discovery. The prompt does not skip Discovery or name the questions in advance.
7. The Cursor key stays out of the agent. The desktop process, not the test, creates the question and sends the follow-up when the window answers.
8. The recording is that window, once as the project manager and once as the developer, taken while the run is happening.

## Objective

Show that the factory workflow works in the application that ships.

- Discovery, Implementation, and Delivery happen in that order, on the phase bar.
- A human question appears at the stop, in the role's own window.
- The workflow waits for the answer and resumes from it.
- The phase bar, the question list, and Continue match the run as it moves.
- The whole path can be watched in the app. Passing the pieces separately is not that path.

## The run

Two dev instances, distinct `DYAD_DEV_USER_DATA_DIR`, one organization app, three phase chats. One instance is the project manager. The other is the developer.

1. Discovery starts in the app. The agent runs.
2. When the agent stops for the project manager, the project-manager window shows the question body and the answer form inside `FactoryPhaseBar`. The developer window shows the waiting line only.
3. The project manager answers in the window. The question stays open until that answer. No second question is created to stand in for it.
4. The same agent continues. The next prompt contains the answer. The project-manager window shows the question answered. The developer still does not see that body.
5. The agent writes the Discovery summary. Continue stays unavailable to the developer. Continue becomes available to the project manager only after the summary. Delivery is still locked.
6. The project manager approves. Implementation unlocks and starts. Discovery stays approved.
7. Implementation repeats the question loop for the question the agent actually asks. The developer answers in the developer window. The project manager sees status only on that question.
8. The Implementation summary appears. The project manager approves. Delivery unlocks. The developer still cannot approve.
9. Delivery runs to its summary. The project manager can approve delivery.

The Cursor agent is a normal agent for this app, not a no-repo plan agent whose prompt lists the two questions and the phase. The marker format may be in the phase prompt. The script must not say "Discovery is already approved" or "ask these two questions, then stop."

## What has to be connected

These are missing today. Each one is how the window joins the loop. Building them without the run above does not finish the plan.

- `FactoryPhaseBar` already lists questions with `ipc.factory.listQuestions` and answers with `ipc.factory.answerQuestion`. Those IPC handlers are the UI path. The test must not post the question or the answer beside them.
- `answerQuestion` calls `answerHitlQuestion` with no Cursor follow-up sender. `startFactoryHostBridge` calls `resumeAnsweredFactoryQuestions` with no sender. A click in the app stores the answer and leaves a `cursor-run:` question unresolved. The desktop process registers the sender. The sender posts the follow-up and records the new run id. The token stays in that process.
- The host classifies the finished Cursor message and creates the question the phase bar already knows how to list. The Action may hold the key. The question still has to arrive through the app's store, and the answer still has to leave through the app's button.
- Phase shade, Continue, and the question list read the same approvals, summaries, and questions the run just wrote. The recording is the two instances during steps 1–9.

## Evidence

One recording per role, of the instances in "The run", covering that role's part of steps 1–9. The log records the app id, both question ids, both answer ids, each Cursor run id, and each approval.

A line in the old verification list can stay green and this plan can still be open. The plan is done when steps 1–9 are visible in the two windows, including the phase change, the pause, the resume, and the role split.

## What the scaffolding already established

Kept, and not re-litigated. None of it is the run above.

- The parser, the classifier, a question with no bead, one resume per answer, and resume after a restart are covered by unit and bridge tests.
- Both Continue IPC paths refuse a developer and accept a project manager. The bridge machine token can still approve.
- Two Cursor passes in GitHub Actions wrote `## Request for project-manager`, then `## Request for developer`, then `## Implementation summary`. The passes started in Implementation because the prompt said Discovery was already approved. The prompt named both questions. The agent had no repository. Questions were posted by the test to the bridge. The desktop sender was not registered. [Run 38007957688](https://github.com/Awannaphasch2016/dyad/actions/runs/38007957688), [run 38027897774](https://github.com/Awannaphasch2016/dyad/actions/runs/38027897774).
- The role clips of that second pass replay `HitlQuestionList` with the run's text. Submit changed the preview's own state. They are not steps 1–9.

Section 8 decisions from that scaffolding still stand as bridge findings: no bead for these questions, the marker is the carrier, resume stays in the bridge, `resolve_hitl_answer.py` stays for bead gates, `stepId: "question"` stays, both approval paths stay behind `requirePhaseApproval`. The app run is what says whether those findings hold once the window is the one answering and approving.

## Still out of scope

Configurable phases. Paperclip. Spec Kit or OpenSpec installation. Editing `scripts/gascity/`, GasCity, the Neon schema, or `hitl.py`. A webhook. Putting the Cursor token in the agent environment.

## Order

Wire the desktop sender and the host classification so the existing phase bar is on the path. Then do steps 1–9 once, in the two instances, and record both windows. Do not add another isolated pass to stand in for a step that the windows have not shown.
