# Config-driven agent UI walkthrough

One GitHub Actions workflow runs a full UI walkthrough for any app. The app is a config file. The engine does not mention Vibe SDK, Dyad, Bolt, or a methodology by name.

The engine is the `hitl` job in `.github/workflows/preview-vibesdk.yml` and the loop in `e2e-vibesdk/tests/two-roles.spec.js` from [PR #128](https://github.com/Awannaphasch2016/dyad/pull/128). The rule that the reply is not written ahead of time is [PR #127](https://github.com/Awannaphasch2016/dyad/pull/127). The Cursor client is the create, poll, and delete sequence in `.github/workflows/hitl-cursor-probe.yml`.

## Split

The job holds the browsers and the Clerk tickets. A Cursor Cloud Agent decides each reply. The agent does not receive `CLERK_SECRET_KEY` and does not spend the sign-in ticket. The ticket lasts 300 seconds and is created and spent in the job.

`dyad-bridge-signin.yml` stays the scripted five-minute check. It is not this workflow.

## Where the files go

| File                            | From                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `.github/workflows/ui-walk.yml` | The `hitl` job, with the branch pin removed. `workflow_dispatch` takes a config path. |
| `e2e-walk/walk.mjs`             | The loop in `e2e-vibesdk/tests/two-roles.spec.js`. It reads the config.               |
| `e2e-walk/configs/vibesdk.json` | The selectors and prompt that are hardcoded in that spec today.                       |
| `e2e-walk/configs/dyad.json`    | The composer test ids for the Superpowers run.                                        |

A later app adds a file under `e2e-walk/configs/`. It does not add a workflow or a spec.

## Configurable knots

These are the only fields a config may set. Anything else is the engine.

### Target

| Knot      | What it sets                                                                                  |
| --------- | --------------------------------------------------------------------------------------------- |
| `url`     | The page both browsers open.                                                                  |
| `secrets` | Doppler project and config the job fetches before launch. Names only. Values stay in Doppler. |

### Roles and sign-in

| Knot                | What it sets                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `roles[].id`        | `project-manager` or `developer`. This is the role the decider is told, and the role a gate may name. |
| `roles[].userIdEnv` | The environment variable that holds the Clerk user id. The config does not contain the id.            |
| `roles[].orgIdEnv`  | The environment variable that holds the Clerk organization id.                                        |
| `roles[].ready`     | Text or selector that is visible only after that role is signed in.                                   |

The ticket lifetime is 300 seconds. It is not a knot.

### Start

| Knot            | What it sets                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `start.actor`   | Which role performs the first action. Empty means the app starts the run by itself.                                           |
| `start.field`   | Selector for the box that role types into.                                                                                    |
| `start.text`    | The text typed there.                                                                                                         |
| `start.submit`  | How that text is sent. `enter` or a button name.                                                                              |
| `start.ready`   | URL or selector that means the app exists.                                                                                    |
| `start.refused` | What the other role does, and the URL or selector that must stay unchanged. Empty means the other role does not try to start. |

### Question

| Knot                     | What it sets                                                                  |
| ------------------------ | ----------------------------------------------------------------------------- |
| `question.body`          | Selector for the question text. Only the addressed role may see it.           |
| `question.waiting`       | Selector for the waiting line on the other role.                              |
| `question.field`         | Selector for the box the addressed role types into.                           |
| `question.submit`        | `enter` or a button name.                                                     |
| `question.hideFromOther` | When true, the run fails if the other role's page contains the question text. |

### Phase actions

| Knot                  | What it sets                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `approve.button`      | Button the job clicks after the decider returns `approve`. Empty means this app has no approve button. |
| `approve.roleByPhase` | Which `roles[].id` may approve each phase name. A click from any other role fails the run.             |
| `sendBack.button`     | Button the job clicks after the decider returns `request-changes`.                                     |
| `sendBack.field`      | Where the feedback text goes before that click.                                                        |

### Decider

| Knot                   | What it sets                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `decider.instructions` | The text sent with the question. It tells the agent the reply shape: one sentence, or `approve`, or `request-changes` plus feedback. |
| `decider.screenshot`   | Whether the job attaches the addressed role's screenshot.                                                                            |
| `decider.maxChars`     | How much of the agent's reply the job will type.                                                                                     |

The Cursor endpoint, plan mode, no pull request, and deleting the agent afterward are the engine. They are not knots.

### Loop

| Knot                | What it sets                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- |
| `loop.pollMs`       | How often both pages are read.                                                        |
| `loop.quietMs`      | How long both pages must stay free of a question before the run looks for completion. |
| `loop.maxQuestions` | Stop after this many replies.                                                         |
| `loop.timeoutMs`    | Stop the walk and upload evidence even if completion is not met.                      |

### Completion

| Knot                  | What it sets                                |
| --------------------- | ------------------------------------------- |
| `completion.selector` | What must be visible when the walk is done. |
| `completion.roles`    | Which roles must see it.                    |

### Evidence

| Knot             | What it sets                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `evidence.video` | Width and height of each recording.                                                                                        |
| `evidence.shots` | Which moments to screenshot: signed in, question, waiting, replied, approved, complete.                                    |
| `evidence.log`   | Which ids to write: role, question text hash, Cursor agent id, verdict. The log never writes a ticket, a key, or a secret. |

## What the engine always does

Sign in with a Clerk ticket. Open one browser context per role. Record video. Poll. Refuse a question that both roles can see. Call one Cursor Cloud Agent per open question. Type or click only in the session whose role matches. Upload both videos, the screenshots, and the log. Mask secrets in the Actions log.

## First two configs

`vibesdk.json` reproduces the PR #128 run: Project Manager types "Build a website for a neighborhood shop.", question test id `org-question`, waiting test id `org-waiting`, reply is the last textarea and Enter, no approve button, done after one or more answers and three quiet minutes.

`dyad.json` is the composer: no start text, question body inside `chat-input-container`, waiting test id `hitl-wait-*`, submit button "Submit answer", Approve and Send back on the phase bar, Discovery and Delivery approved by `project-manager`, Implementation approved by `developer`, done when Delivery is approved and both roles see download.

## Order

1. Extract the runner and the workflow. `vibesdk.json` is the only config. The decider can still be the existing OpenRouter call until the Cursor client is wired.
2. Replace that call with the probe's Cursor client.
3. Add approve and send-back, then add `dyad.json`.
4. The Superpowers GIT run dispatches `ui-walk.yml` with `dyad.json`.

## Out of scope

A second workflow per app. Putting the Clerk secret in the Cursor Cloud Agent. Reusing `dyad-bridge-signin.yml` for a live question. Changing the 300 second ticket.
