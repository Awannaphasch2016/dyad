# Forma agent HITL run

Recorded 2026-10-11. This is the fixture run of `plans/forma-agent-hitl.md`. It is not a live model build and not a preview deploy.

## What ran

Forma branch `cursor/forma-agent-hitl-5014`, commit `aa7be4d96224492a8961e78deb38d02803ad23ce`, based on forma pull request 3 (`53191a6e`, shared Clerk sign-in).

The commit is local. Push to `Awannaphasch2016/forma` returned 403 for this token. The same diff is `plans/forma-agent-hitl.patch` in this pull request. Apply it onto forma `cursor/forma-shared-auth-5014`.

Command, from that Forma tree:

```sh
pnpm exec vitest run
```

Result: **7 files passed, 55 tests passed.**

The four proofs below are inside that suite. They drive the real worker against PGlite and a fixture agent reply. Clerk, OpenAI, and the preview host are not called.

## Test A — Project Manager question

`routes a project-manager question to that role and resumes the same session`

Fixture reply:

```text
## Request for project-manager

Which name should the page use?
```

Passed. The run checked:

- Project status is `waiting_for_human` and `active_job_id` is empty.
- The build check does not run.
- The shared transcript does not contain the question.
- The Developer ask is empty. The Project Manager ask is the question, not uncertain.
- A new edit while the question is open is rejected with 409.
- A Developer answer is rejected with 403, and the question stays open.
- The Project Manager answer starts one follow-up. Repeating the same request id returns that same job.
- The follow-up prompt contains the question and the answer `North Pier`.
- The shared transcript still does not contain the question.
- The follow-up uses the same `session_id`. One session was created.
- After the follow-up finishes with no heading, status is `ready`.
- Another organization gets 404 for the project.

## Test B — Developer question

`routes a developer question to that role and hides it from the project manager`

Fixture reply:

```text
## Request for developer

Which database should the menu use?
```

Passed. The Developer sees that question. The Project Manager ask is empty. The transcript does not contain the question. The Developer answer `Postgres` continues the same `session_id`, and the project then becomes `ready`.

## Test C — Task completion

`completes a turn that has no request and stores no question`

Fixture reply: `The page is ready.`

Passed. Status is `ready`. The question table has zero rows. Neither role has an ask.

## Also passed

`shows an unknown role only to the project manager as uncertain`

Fixture reply `## Request for reviewer` stays `waiting_for_human`. The Project Manager sees the body with uncertain set. The Developer ask is empty.

Heading parser: last request wins, a thinking block is ignored, a code fence is ignored, an empty body is uncertain, and a reply with no heading completes.

The older lifecycle tests still pass, including follow-up, stop, reopen, and the owner lock.

## What this run does not prove

- Two live Clerk browsers. This environment has no Clerk secret, so the ticket sign-in job was not started.
- A preview deploy, or a turn written by a live model.
- The generated-app preview URL is still public. That was left out of this run on purpose.

## Repeat

```sh
git clone --branch cursor/forma-shared-auth-5014 https://github.com/Awannaphasch2016/forma.git
cd forma
git apply /path/to/plans/forma-agent-hitl.patch
pnpm install
pnpm exec vitest run tests/request-marker.test.ts tests/lifecycle.test.ts
```

The pass line to look for is `Tests  24 passed`. The full suite line is `Tests  55 passed`.
