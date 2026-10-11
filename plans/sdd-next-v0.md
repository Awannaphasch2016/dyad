# Spec-driven GIT Conference site on Next.js, implemented by v0

> Plan only. Nothing in this document has been executed. Written 2026-10-11 from the finished PHP experiment (`plans/sdd-speckit-experiment.md`, runs `gitcon-v1` on `cursor/sdd-experiment-harness-be23`).

## Summary

Run the same four-page GIT 2025 site again as a new specification, `gitcon-next-v1`. The pages, copy, fixtures, and contact rules stay those of `gitcon-v1`. The runtime becomes a Next.js App Router app that reads the fixtures on every request. v0, called through its API, is the only implementer. The orchestrator freezes the spec first, withholds the tests, downloads the generated files, and runs a ported Playwright suite locally. The PHP result stays untouched and is not merged.

## Problem Statement

The PHP runs showed that a frozen spec plus a hidden executable suite can score an implementation. They also showed that the suite is bound to PHP and Apache, and that Grok 4.7's self-check on `php -S` hid the one real failure. The next question is whether the same contract, expressed for Next.js and implemented by v0, produces a site that passes the same behavioral checks. v0 is not a model id on the Cursor Cloud Agents API, so it cannot replace Grok inside the old worker prompt.

## Scope

### In Scope (MVP)

- A new spec version, `gitcon-next-v1`, copied from the page and form contract of `gitcon-v1`, with the runtime section rewritten for Next.js.
- The same four routes: `/`, `/program`, `/registration-fee`, `/contact`.
- The same fixtures, including the fictional programme sessions that make a copy of the live page fail.
- v0 API v2 as the implementer: one chat, the spec as the message, files downloaded from that chat and committed.
- A ported Playwright suite run against `npm run build` and `npm start` on port 3000.
- One repair pass only if that suite fails. The repair pass is a new Cursor agent. It may not edit the spec and it may not see the test source.
- The same isolation rules: no ground-truth repository, no live-site fetch, no Dyad app changes.

### Out of Scope (Follow-up)

- Replacing or rescoring the PHP runs. `gitcon-v1` stays hash `30916614bd4380d1a93c92432e9753f3038ecfacd6e976906332ad4086485127`, 20 of 20 on Run 2.
- Thai, accounts, search, galleries, CMS, reCAPTCHA, email, and the rest of the live site.
- Deploying the v0 sandbox or a Vercel project as the thing the verifier scores. The sandbox preview can disappear. The score is the committed source, built locally.
- Using v0 to regenerate the specification, the acceptance tests, or the fixtures.
- A visual-quality judge. Screenshots are evidence. They are not a score.
- Installing the Spec Kit bug extension, or running `specify workflow run`.

## User Stories

- As the experiment owner, I want the Next.js site judged on the same pages and form behavior as the PHP site, so a pass means the contract was met rather than that v0 produced a plausible homepage.
- As the orchestrator, I want the spec frozen and hashed before v0 is called, so a later edit cannot move the target.
- As a reviewer, I want the generated Next.js project to be ordinary source in git, buildable with `npm ci && npm run build && npm start`, with no requirement that v0 keep running.

## UX Design

The public site has the same four pages as `gitcon-v1`.

### User Flow

1. Open `/`. See "GIT 2025", the theme, the dates, the place, and the three about paragraphs.
2. Open `/program`. See both day headings and one table per day, read from `data/program.json`.
3. Open `/registration-fee`. See both fee tables, read from `data/fees.json`.
4. Open `/contact`. Submit an empty form and see field errors. Submit a valid form and see the confirmation. A second valid submit appears in `/contact/submissions.json`.
5. Open an unknown path and see the 404 page with the shared navigation.

### Key States

- **Default**: each page has one `h1`, one `main`, the four nav links, and the footer.
- **Loading**: the production server is already built. Pages are server-rendered. No client-only blank screen is acceptable for the four routes.
- **Empty**: before any successful contact post, `GET /contact/submissions.json` is `[]`.
- **Error**: a failed post returns HTTP 200 with `data-error` on the failing fields and no `data-confirmation`. The values the user typed stay in the controls.

### Interaction Details

The form posts to `/contact` as `application/x-www-form-urlencoded`. Group, subject, message, name, and email are required. Phone is optional. The error strings and `data-error` attribute names stay those in `gitcon-v1` section 4.4, so the contact tests can be carried over with a different base URL.

### Accessibility

Same structural bar as AC-15 and AC-18: at 375 px the four links are visible or behind one button, with no horizontal overflow. Each page has one `h1`, one `main`, and no duplicate `id`. Styling is otherwise free. v0's visual polish is not given extra points.

## Technical Design

### Architecture

Three roles, and they do not share a chat.

| Role | What it is | What it receives |
| --- | --- | --- |
| Orchestrator | The Cursor Cloud Agent on the Dyad harness branch | The approved slice, `gitcon-v1`, and this plan |
| Implementer | One v0 chat created with `POST https://api.v0.dev/v2` through `v0.chats.create` | The frozen `gitcon-next-v1` text only |
| Verifier | GitHub Actions, Playwright, Node. Not a model | The committed Next.js tree at one SHA, plus the hidden tests |

v0 is a Vercel product with its own API and API key. It is not selected by the Cursor `model.id` field that launched Grok 4.7. Official description: a prompt goes in, v0 generates an app in a VM-backed chat, and the files can be downloaded ([v0 API v2](https://v0.app/docs/api/v2), [Download Chat Files](https://api.v0.dev/v2/chats/{chatId}/files/download) as `GET /v2/chats/{chatId}/files/download`).

The PHP worker prompt and Spec Kit's specify → plan → tasks → implement cycle are not repeated. `gitcon-v1` is already the specification of the pages. Running specify again would let a model rewrite that contract. Spec Kit's plan and task templates are not sent to v0. v0 does its own internal planning inside the chat. That planning is an implementation trace, not a second source of requirements.

```text
orchestrator writes gitcon-next-v1 and hashes it
        |
        v
v0.chats.create({ message: SPEC.md })
        |
        v
GET /v2/chats/{chatId}/files/download
        |
        v
commit on sdd-gitcon-impl, branch exp/<run-id>
        |
        v
Actions: npm ci && npm run build && npm start
        |
        v
ported Playwright suite
        |
        +--  all behavioral checks pass --> stop, record the SHA
        |
        +--  any fail --> one Cursor repair agent, new chat,
                          starting at that SHA, spec hash unchanged
                          --> verifier once more --> stop
```

### Components Affected

This plan does not edit Dyad application code. When execution is approved, the harness changes are limited to:

- `experiments/sdd/specs/gitcon/next-v1/requirements.md` — the new frozen spec.
- `experiments/sdd/specs/gitcon/next-v1/acceptance/` — ported tests and criteria. The worker and v0 never receive this directory.
- `experiments/sdd/bin/start-v0.mjs` — calls the v0 API, downloads the zip, and records the chat id. Node built-ins plus the documented HTTPS API. The API key is read at runtime and never written into the repo or the prompt log.
- `.github/workflows/sdd-verify.yml` — a Next.js job path selected by `spec_version`, leaving the PHP job path in place for `gitcon-v1`.
- `Awannaphasch2016/sdd-gitcon-impl` — a new branch only. `main` and the PHP commits `bc32948` and `1b0784ea` stay as they are.

### Data Model Changes

No Dyad database change. The site still stores contact messages as JSON lines under `data/` inside the running process, and exposes them at `GET /contact/submissions.json`. The spec requires the pages to read `data/program.json` and `data/fees.json` on every request. Inlining those fixtures into a React component fails the programme and fee checks the moment the file is edited, which is the existing AC-19 rule.

### API Changes

No Dyad IPC change. The new outbound call is from the orchestrator to `https://api.v0.dev/v2`, authenticated with a bearer token named `V0_API_KEY`. The finished website does not call v0.

## What stays, and what changes, relative to gitcon-v1

| Piece | gitcon-v1 (PHP, Grok 4.7) | gitcon-next-v1 (Next.js, v0) |
| --- | --- | --- |
| Pages, copy, nav, footer | Frozen | Copied unchanged |
| Fee figures and Monday keynote | Real, from the live HTTP observation | Copied unchanged |
| Remaining programme rows | Fictional, so a live-page copy fails | Copied unchanged |
| Contact field rules and error strings | Frozen | Copied unchanged |
| Runtime | PHP 8.2, Apache, root `Dockerfile` | Next.js App Router, `npm run build`, `npm start` on port 3000 |
| Implementer | Cursor Cloud Agent, model `grok-4.7`, Spec Kit skills | v0 chat. No Spec Kit skill invocation |
| Self-check the implementer is told to trust | `php -S` on Run 1. Docker on the repair prompt | None inside v0. The score is only the Actions run |
| Verifier | Playwright against Apache on port 8080 | Playwright against Next on port 3000 |
| Pass number | 20 of 20 on the PHP suite | A new count. Not comparable as "better than 20/20" |

Checks that move over by changing the base URL and the start command: navigation, footer, home copy, programme rows, fee cells, form control names, empty-post errors, invalid email, confirmation, second submission, 404, 375 px navigation, one `h1` and one `main`, fixture edit on `/program`, leak scan.

Checks that are rewritten rather than copied:

- Image build becomes `npm run build` exiting 0.
- Process start becomes `npm start` answering `GET /` with 200 within 60 seconds.
- The Apache "no network at runtime" container check is not copied. Next's production server is scored only on local fixtures and the absence of calls to the live conference host during the suite. A failed outbound attempt to that host fails the run. This is a different check from PHP AC-17, and the report must say so.

## Implementation Plan

Execution waits for an explicit go-ahead and for `V0_API_KEY`. This document does not start a chat.

### Phase 1: Freeze the Next.js spec

- [ ] Add `experiments/sdd/specs/gitcon/next-v1/` by copying the `gitcon-v1` page, fixture, and contact sections.
- [ ] Replace section 2 with the Next.js runtime: App Router, request-time reads of the two JSON files, contact storage under `data/`, `npm run build` and `npm start -p 3000`.
- [ ] State that the app must not import from the live site, must not add pages, and must not call v0 from the running site.
- [ ] Render `requirements.md`, hash it, and record the hash in the run schema as `spec_version: gitcon-next-v1`. Do not change the `gitcon-v1` hash.

### Phase 2: Port the verifier before calling v0

- [ ] Copy the Playwright files. Point them at `http://127.0.0.1:3000`.
- [ ] Replace the PHP image steps with `npm ci`, `npm run build`, and `npm start`.
- [ ] Keep the spec-hash check and the leak scan.
- [ ] Run the suite against a stub Next app that implements only the layout, in the same spirit as the PHP smoke fixture, and confirm the contact and programme checks fail. Do not call v0 until that failure is on record.

### Phase 3: One v0 implementation

- [ ] Preflight: the key is present, `gitcon-v1`'s hash is unchanged, and the prompt contains the new spec and none of the leak markers (`dev25-git-con`, the live host, `Awannaphasch2016/dyad`, `experiments/sdd`).
- [ ] `v0.chats.create` with one message: the full `gitcon-next-v1` text, plus the instruction to build a Next.js App Router app and to stop. No acceptance-test text. No second message unless the download fails.
- [ ] Download `GET /v2/chats/{chatId}/files/download` and commit those files on `exp/<run-id>` in `sdd-gitcon-impl`. Record the chat id and the SHA in `run.json`.
- [ ] Push `run.json` so the existing verify workflow runs. Do not treat `demoUrl` as a result.

### Phase 4: One repair, then stop

- [ ] If every ported behavioral check passes, record the SHA and stop.
- [ ] If any fail, start one new Cursor Cloud Agent from that SHA. The prompt names the failing routes and the spec sections. It does not include the test files. It forbids edits to `SPEC.md`.
- [ ] Verify that commit once. Whatever the score, stop. No third implementer and no second v0 chat.

## Testing Strategy

- [ ] The smoke stub fails the contact and programme checks before v0 runs.
- [ ] The v0 commit is scored only by the Actions job, on a clean `npm ci && npm run build && npm start`.
- [ ] `SPEC.md` in that commit matches the `gitcon-next-v1` hash.
- [ ] The leak scan is clean.
- [ ] The report lists PHP `gitcon-v1` and Next `gitcon-next-v1` as separate scores. It does not subtract one from the other.
- [ ] A known-bad edit of one programme title in `data/program.json` changes `/program` without a rebuild. If the page was baked at build time, that check fails.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| v0 inlines the copy and the fixtures, so AC-19 cannot pass | High | High | The spec forbids inlining. The smoke suite includes the fixture-edit check. One repair agent may fix the reads. The spec is not weakened to match v0. |
| v0 emits a different stack than Next.js App Router | Medium | High | The build step fails. That is a recorded result, not a cue to change the spec. |
| v0's `demoUrl` is treated as the product | Medium | High | The verifier never opens `demoUrl`. It builds the zip. |
| The API key lands in a log or a commit | Medium | High | The key is an Actions secret or Doppler entry named `V0_API_KEY`. The downloader prints only the chat id and the HTTP status. |
| Someone compares this score with PHP 20/20 | High | Medium | The report has two named suites. The runtime checks are labeled as rewritten. |
| A repair agent is given the tests and fits them | Medium | High | The repair prompt gets the failing symptom and the spec section, the same boundary as the PHP follow-up. |
| v0 searches the live site despite the prompt | Medium | High | Leak scan plus the fictional programme rows. A match to a fictional row is required. A page that instead matches the live programme fails. |

## Open Questions

These are assumptions, not blockers, unless the go-ahead says otherwise.

- `V0_API_KEY` is not in the repo. Execution cannot start until it is stored the same way `CURSOR_API_KEY` is stored, as a named secret. This plan does not ask for the key value in chat.
- The download endpoint used is v2 `GET /v2/chats/{chatId}/files/download`. If that zip omits `package.json`, the run stops and records the missing file. It does not fall back to the deprecated v1 version API unless the v2 response documents that the files are elsewhere.
- The repair model, if phase 4 happens, is whatever model id is current on `GET /v1/models` at execution time. It is not v0, and it is not chosen in this plan.

## Decision Log

- **New spec version, not an edit of `gitcon-v1`.** The PHP hash and the 20/20 result stay comparable to themselves. Confirmed by the finished run records.
- **v0 implements. v0 does not write the spec.** The Drive folder had no GIT Conference functional spec. The page contract was written by the orchestrator from the live HTTP observation and the approved slice. Repeating that with a generator would move the target. Verified in plan section B.1a.
- **Spec Kit skills are not invoked on this run.** They were how Grok turned an already-frozen spec into `spec.md`, `plan.md`, and `tasks.md`. The page contract does not need to be generated again. v0's internal planning is not accepted as a replacement spec.
- **The verifier stays executable and hidden.** v0's preview and Spec Kit's converge step both failed that bar on the PHP run: the preview is not a test, and converge never executed Apache.
- **One repair, then stop.** Same stopping rule as section H of the PHP plan. An open loop until green trains the implementer on the verifier.
- **Same repository, new branch.** `sdd-gitcon-impl` already holds the PHP site. The Next.js app is a branch, not a rewrite of `main`.
- **Dyad application code stays out.** The experiment remains harness, spec, and the implementation repo.

---

_Plan only. Not executed._
