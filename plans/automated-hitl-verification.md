# Automated HITL verification

> Verify the two-role walkthrough at `https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev` without a human clicking, without weakening the two real accounts, and without trusting an agent's description of what it saw.

## Recommendation

Run one Playwright test on one GitHub Actions runner. The test opens two isolated browser contexts (Project Manager, Developer), signs each in with a Clerk sign-in token minted from `CLERK_SECRET_KEY`, and drives the walkthrough as a single deterministic script. Turn-taking is sequenced by the script and confirmed against the application's own shared state (`GET /api/project`, then Postgres) before every step. Evidence is the Playwright trace, video per context, a screenshot per checklist item, and the saved API snapshot per step, uploaded as workflow artifacts.

No agent-to-agent protocol, no durable workflow engine, no hosted browser service is needed for a walkthrough that completes in minutes. Those become relevant only if a session must outlive a job or a human must take over a browser mid-run (Phase 3).

## Verified constraints

These were checked against the live preview, the Clerk development instance, and this repository.

| Fact                                                                                                                                                                                                                                                                                                             | Consequence                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clerk instance `hardy-moth-75.clerk.accounts.dev` is `development`. Password, email code, username, phone, authenticator, passkey are all `enabled=false`. Only `oauth_google` and `oauth_microsoft` are on. Sign-up captcha is Turnstile "smart". MFA is not required. Organizations are on, max 5 memberships. | Email+password sign-in does not exist today. Enabling it is a Dashboard change on the development instance only. A sign-in token needs no instance change.               |
| `handleProjectRequest` resolves the one app `bolt-walkthrough`, owned by org Wewebplus (`org_3JuOz4PCITqmueMeKYhcFUXAEIH`). The caller must be a Clerk member of that org **and** have a `wewebplus.memberships` row with `project-manager` or `developer`. Otherwise `404 Not found`.                           | An account in a different org cannot see the project at all. Test accounts must be in Wewebplus. The user's "same role, different orgs" variant can only verify the 404. |
| `DOPPLER_ADMIN_TOKEN` exists only in GitHub Actions. `export-bolt-preview-env.mjs` already loads `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `WEWEBPLUS_DATABASE_URL` from Doppler `bolt/preview`. No credential exists in a Cursor agent VM.                                                                   | The verification job is a GitHub Actions job. Nothing is copied into bolt.diy secrets; `bolt/prd` stays empty.                                                           |
| The page polls `GET /api/project` every 2 s after `clerkReady`. The waiting card, phase bar, and Download only update while the page is open.                                                                                                                                                                    | Both browsers stay open for the whole run. Save/restore of sessions is a retry fallback, not the primary design.                                                         |
| Both repos already depend on `@playwright/test` (Dyad `^1.58.2` with `e2e-tests/`, bolt.diy `^1.63.0`).                                                                                                                                                                                                          | No new browser framework.                                                                                                                                                |
| GitHub Actions job timeout is 6 h. A full walkthrough is minutes.                                                                                                                                                                                                                                                | Durable workflow engines are not needed for the happy path.                                                                                                              |
| Stable hooks exist: `bolt-sign-in`, `bolt-account`, `factory-phase-{discovery,implementation,delivery}`, `shared-gate`, `shared-gate-transition`, `shared-gate-waiting`, `shared-download`, `aria-label="Implementation answer"`, placeholder `Describe the page`.                                               | Assertions use these, not screenshots or model judgement.                                                                                                                |
| Dyad can push to `Awannaphasch2016/dyad` only. Bolt is checked out at deploy from `cursor/website-walkthrough-55d6` and patched.                                                                                                                                                                                 | Test code lives in this repo under `scripts/doppler/` and a new `e2e-walkthrough/` folder, like the deploy patches.                                                      |

## Architectural comparison

### Coordination options

| Option                                 | What it is                                                      | Fit for this walkthrough                                                                                               | Verdict                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A. Two persistent browsers, two agents | One LLM agent per role, each with its own browser, taking turns | Two non-deterministic actors must agree on whose turn it is; cost and flakiness double; the result is an agent's claim | Reject for the scripted checklist. Possible later for exploratory testing (Phase 3).                                                   |
| B. Central orchestrator                | One script owns both browsers and sequences every action        | Deterministic, one log, one artifact set, one place to assert                                                          | **Adopt.** One Playwright test, two `browser.newContext()`.                                                                            |
| C. Agent-to-agent                      | Role agents message each other to hand over turns               | Adds a bus that duplicates what the app already stores                                                                 | Reject. The application is the shared state.                                                                                           |
| D. Database / event-driven             | Actors watch shared state and act when it changes               | This is how the app itself works (2 s poll of Postgres)                                                                | **Adopt as the verification oracle, not as a second bus.** The orchestrator waits on `expect.poll(GET /api/project)` before each step. |

B and D together: the script decides the order; the server snapshot proves the other side really received the change before the next action.

### Platforms

| Platform                                                           | Isolation                                                              | Persistence                                                                                         | Evidence                                                      | Cost                                                                                               | Fit                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playwright on a GitHub Actions runner (recommended)                | Per browser context: cookies, localStorage, IndexedDB, service workers | Lives for the job; `storageState` export/import for retries                                         | Trace (DOM, network, screenshots), video, `page.screenshot()` | Included runner minutes (Linux ~$0.008/min on private repos after the free tier; a run is ~10 min) | Right size. Already a dependency. Credentials already flow through this job type.                                                                                                    |
| Browserbase + Stagehand                                            | Per cloud session; Contexts persist cookies/storage across sessions    | Developer plan sessions up to 6 h, 25 concurrent; recordings 30 days; Live View with human takeover | Session recording, Live View URL                              | Free $0 (1 h/mo, 15-min sessions); Developer $20/mo (100 h, $0.12/h overage); Startup $99/mo       | Use when a human must watch or take over a bot's browser, or a session must outlive a job. Stagehand `act/extract/observe` is LLM-driven; good for exploration, weaker as an oracle. |
| Browser Use Cloud                                                  | Per cloud browser                                                      | Up to 4 h per session, 10 concurrent baseline                                                       | Recordings, agent logs                                        | $0.02 per browser-hour, per-minute billing                                                         | Cheapest hosted browser. The agent library is Python and LLM-driven; the result is a claim unless paired with API checks.                                                            |
| Cloudflare Browser Run (Browser Rendering)                         | Per browser in the Workers platform                                    | Durable-Object-held sessions, `keep_alive` up to 10 min idle; no fixed max while active             | Screenshots via API                                           | ~10 browser-hours/month included on Workers Paid, then $0.09/h; Free plan 10 min/day               | Natural if the orchestrator ever moves into the same Cloudflare account as the Worker. Not needed while GitHub Actions is the entry point.                                           |
| Durable workflow engines (Temporal, Inngest, Cloudflare Workflows) | n/a                                                                    | Hours to days; retries; human-wait steps                                                            | Workflow history                                              | Free tiers exist; operational overhead                                                             | Only if a step must wait on a real human for hours between bot steps. The walkthrough has no such step when both roles are bots.                                                     |

## The eight questions

1. **Authentication without interactive MFA.** Feasible, two ways, both on the development instance only.
   - **Sign-in token (recommended):** `POST https://api.clerk.com/v1/sign_in_tokens { user_id }` with `CLERK_SECRET_KEY`, consumed in the page by `window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })`. `@clerk/testing/playwright` wraps this as `clerk.signIn({ page, emailAddress })` and also mints a Testing Token so Turnstile does not block the browser. It bypasses MFA and email verification by design. Needs nothing in Doppler beyond the keys already there. **Found in run 37926993840:** a sign-in token is refused for a user with no identification (`The given token doesn't have an associated identification`), and while the Email address attribute is off the Backend API refuses both `POST /users { email_address }` (`email_address is not a valid parameter`) and `POST /email_addresses` (`feature_not_enabled`). So the one Dashboard change that is required is the **Email address attribute** on the Development instance; the password attribute stays off.
   - **Email+password (the user's proposal):** requires turning on the password attribute in the Dashboard and storing a test password in Doppler. Works with `+clerk_test` addresses (no email sent; OTP `424242`). Keep it as a fallback if the sign-in form itself must be exercised; it is not needed to verify the HITL flow.
   - The two real accounts are never typed into, and their Google/Microsoft settings are untouched.
2. **Browser isolation: two machines or one.** One runner, two Playwright contexts. Contexts share nothing (cookies, storage, IndexedDB, service workers). The app distinguishes users only by the Clerk session cookie and Bearer token, so one machine is sufficient and simpler to record. Two machines add network coordination for no isolation gain.
3. **Persistence vs save/restore.** Keep both pages open for the run (minutes). The 2 s poll only updates an open page, and the waiting card is one of the things under test. Export `storageState` per role after sign-in so a failed step can retry in a fresh context without a new sign-in token. Hosted Contexts (Browserbase) solve the same problem for hours-long sessions and are not needed here.
4. **Orchestration.** Option B with D as the oracle. One test file, one timeline, one artifact set. The orchestrator is a Playwright spec, not an agent.
5. **State synchronization.** The app's own `GET /api/project` snapshot is the sync point. Before the Developer acts, the script waits until the Developer's snapshot shows `phase=implementation` and the question `canAnswer=true`; before the Project Manager approves Delivery, until the PM's snapshot shows `phase=delivery` and `canTransition=true`. The DOM must agree (`shared-gate-transition` enabled, `shared-gate-waiting` on the other side) within the poll interval.
6. **Verifying backend and UI without trusting a claim.** Three layers, all scripted:
   - DOM: `expect(locator).toBeVisible()/toBeDisabled()` on the test ids above, per role, per step.
   - API: the signed `GET /api/project` JSON saved to `artifacts/<step>-<role>.json` and asserted (phase, `canSend`, `canTransition`, `waitingLabel`, question status, message ids present on both sides).
   - Database: at the end, Neon SQL over HTTP (same `neonQuery` as `bolt-sign-in.mjs`): `project_state.phase='delivered'`, `delivered_at not null`, `document_html not null`, answer row for `bolt-walkthrough:implementation:review-approve-dev`, message count on `bolt-walkthrough-chat`.
   - Also the negatives: Developer `POST /api/project {command:'record'}` during Discovery is `403`; unsigned `GET /api/project` is `401`; both downloads are byte-identical.
   - Evidence: Playwright trace (`trace: 'on'`), `video: 'on'` per context, a numbered screenshot per checklist item, the JSON snapshots, and the step summary. No LLM is in the assertion path.
7. **Existing solutions.** See the platform table. For this walkthrough the cheapest reliable option is the one already in the repo. Hosted browsers cost $0–$20/month and earn their place only for Live View, long sessions, or exploratory LLM-driven runs. Workflow engines earn theirs only when a bot must wait hours on a human.
8. **Simplest sequence that evolves to multi-account.** Phase 1 writes the reset script, the test-account script, one context, one role, and the workflow. Phase 2 adds the second context to the same spec; nothing from Phase 1 is replaced. Phase 3 is an evaluation gate, not a rewrite.

## Decisions that need the owner's approval

1. **Create two Clerk test users on the development instance** (`pm+clerk_test@…`, `dev+clerk_test@…`) via the Backend API and add them to Wewebplus (5-membership cap: 2 used, 3 free). This is the "dedicated test accounts" the request asks for and supersedes the earlier "no new accounts" rule for the development instance only. The two human accounts are not modified, and no user is deleted.
2. **Same org, not different orgs.** Because the project is owned by one org, a cross-org account only proves the 404. Phase 1 will assert that 404 once with an account outside the org only if the owner wants it; otherwise both test users go into Wewebplus.
3. **The bot and the humans share the one project.** The job resets `bolt-walkthrough` to Discovery at start and leaves it `delivered` at the end, which is the state the humans see today. Run it only when the humans are not mid-walkthrough. A per-run app id is a later improvement to the workflow module, not part of this plan.
4. **Sign-in tokens instead of enabling passwords.** One Dashboard change on the Development instance: turn on the Email address attribute (User & authentication → Email, phone, username) so the two test users can hold `+clerk_test` addresses. Password stays off. If the owner later prefers the password route, the additions are the Password toggle and one Doppler secret per test account.

## Status

- Done on `cursor/automated-hitl-verification-851d`: `scripts/doppler/bolt-test-accounts.mjs` (two test users `user_3KSMlRRSbdUgnQO6LFhD276Qj2x` PM and `user_3KSMlT5sJc4zq6IwJYazCw6mif9` Dev exist, are Wewebplus members, and have `wewebplus.memberships` rows), `e2e-walkthrough/` (Playwright: preflight, one token sign-in per role, password probe, Markdown summary), `.github/workflows/bolt-walkthrough-verify.yml`.
- The Email address attribute was turned on in the Dashboard (Development instance, sign-up with email, not required, not a sign-in factor). Run 37960548651 then attached both `+clerk_test` addresses and passed 4/4: each role signed in with a sign-in token in about 2.5 s with no human step, `GET /api/project` returned `project-manager` and `developer`, reload kept the session, sign-out returned 401. Phase 1 authentication is proven.
- Password probe result on the live instance: `form_param_value_invalid` ("password does not match one of the allowed values for parameter strategy"); typing a password cannot sign in today.
- Phase 1 ran in [37964371000](https://github.com/Awannaphasch2016/dyad/actions/runs/37964371000): 5/5 passed. The reset returned the project to Discovery. The Project Manager bot stored "A single page that lists the North Pier lunch menu.", the assistant reply was stored, and "Move to Implementation" left `phase=implementation`, an open Developer question, one user message, and one assistant message. Reload kept Implementation. Sign-out returned 401. The project is left in Implementation, waiting on the Developer.
- The Discovery gate is a modal, so it covers the composer for the whole phase (`composerCoveredByGate=true`). The run still sent through the composer's own React handlers. The waiting text after the move is the dialog description "Waiting on the Developer."; `shared-gate-waiting` is not rendered while the Implementation question is open.

## Phase 1: single account, full evidence

Scope: Project Manager only, Discovery through the Implementation transition. The Developer step is not reachable by one account, so the phase ends with the PM's waiting card.

1. **Reset script** `scripts/doppler/bolt-reset-project.mjs`.
   - `update wewebplus.project_state set phase='discovery', document_html=null, delivered_at=null where app_id='bolt-walkthrough'`
   - `delete from wewebplus.messages where chat_id='bolt-walkthrough-chat'`
   - `delete from wewebplus.answers where question_id='bolt-walkthrough:implementation:review-approve-dev'`; `delete from wewebplus.questions where id=…`
   - Roles, memberships, apps, chats are kept. Unit test with the memory store pattern from `bolt-workflow.test.mjs`. Prints only counts.
2. **Test-account script** `scripts/doppler/bolt-test-accounts.mjs`.
   - Idempotent: find-or-create the two `+clerk_test` users (`skip_password_requirement: true`), find-or-create their Wewebplus membership, insert `wewebplus.memberships` rows (`project-manager`, `developer`). Prints user ids and `memberships=4`. Never prints emails of the human accounts or any secret.
   - Refuses to run unless both Clerk keys are `*_test`.
3. **Playwright project** `e2e-walkthrough/` in this repo.
   - `playwright.config.ts`: `baseURL` from `WALKTHROUGH_URL`, `globalSetup` calling `clerkSetup()`, `trace: 'on'`, `video: 'on'`, `screenshot` manual, one worker, 10-min test timeout, Chromium only (Desktop Chrome is the agreed verification browser).
   - `pm.spec.ts`: new context → `clerk.signIn({ page, emailAddress: PM_TEST_EMAIL })` → `bolt-account` visible → `factory-phase-discovery` shown → snapshot `phase=discovery canSend=true` → type in `Describe the page`, press Enter → assistant reply appears in `Messages` → snapshot shows two message ids → `shared-gate-transition` enabled → click → snapshot `phase=implementation`, `waitingLabel` mentions the Developer → `shared-gate-waiting` visible → reload keeps phase → sign out → `/api/project` 401. Screenshot after each arrow.
4. **Workflow** `.github/workflows/bolt-walkthrough-verify.yml`.
   - Triggers: `workflow_dispatch`, and `workflow_run` after `bolt-preview-from-doppler` succeeds.
   - Steps: checkout → `export-bolt-preview-env.mjs` (Doppler, masked) → `bolt-test-accounts.mjs` → `bolt-reset-project.mjs` → `npx playwright install chromium` → `playwright test` → `actions/upload-artifact` (`playwright-report/`, `test-results/`, `artifacts/*.json`, `*.png`, `*.webm`) → step summary with phase per step and artifact names.
   - Secrets: `DOPPLER_ADMIN_TOKEN` only, as today. `set +x` around anything that handles a value.
5. **Exit criteria.** Green run on `workflow_dispatch`; artifacts contain a video, a trace, numbered screenshots, and snapshot JSON for each step; the DB check shows `phase=implementation`.

## Phase 2: two accounts, shared state

Scope: the full 12-point checklist from `plans/builder-session-hitl.md`, both roles as bots.

1. `two-roles.spec.ts` opens `pm` and `dev` contexts and signs each in with its own token. Both pages stay open.
2. Sequence, each step gated on the acting role's snapshot and asserted on both DOMs:
   1. Discovery: PM sends; Dev page shows the same user line and assistant reply without reload; Dev `ChatBox` Enter does nothing; Dev `record` returns 403.
   2. PM moves to Implementation; Dev `factory-phase-implementation` updates within 5 s; PM `shared-gate-waiting`.
   3. Dev answers in `Implementation answer`; PM card shows answered; Dev `shared-gate-transition` enabled, PM's absent.
   4. Dev moves to Delivery; PM card can approve; Dev waits.
   5. PM approves; both show Delivered and `shared-download`; both downloads identical bytes; `project_state.delivered_at` set.
   6. Reload both; state kept. Sign out both; 401.
3. Turn-taking is `expect.poll(() => fetch('/api/project', bearer))` with a 10 s ceiling per handover (five poll ticks). Any timeout fails the run with both snapshots attached.
4. Workbench replay: assert the Dev page's workbench file tree contains the file the assistant wrote, and that no shell action re-ran (console has no second install log). The WebContainer preview iframe is out of scope for the assertion; headless Chromium running WebContainer in CI is a known risk, so the test must not depend on it.
5. Same-org vs cross-org: both bots are Wewebplus members. One optional negative test signs in a third `+clerk_test` user with no Wewebplus membership and asserts `404` and no phase bar. It does not create a second org.

## Phase 3: evaluate hosted infrastructure

Trigger for this phase, any of: a step must wait on a real human for longer than a job; someone wants to watch or take over the bot's browser live; the owner wants exploratory, model-driven coverage beyond the scripted checklist.

- **Browserbase + Stagehand:** swap `chromium.launch()` for `chromium.connectOverCDP(browserbase session)`; Contexts give persistent cookies; Live View for takeover. Stagehand `act()` for exploration, with the same API/DB oracle for verification.
- **Browser Use Cloud:** cheapest hosted browser; Python agent library; pair with the same oracle.
- **Cloudflare Browser Run:** if the orchestrator should live beside the Worker; Cloudflare Workflows for human-wait steps.
- **Durable engines:** only with a real human-wait step.

Decision record after Phase 2: cost per run, flake rate, and whether any of the three triggers above actually occurred.

## Out of scope

- Production Clerk, `pk_live_`/`sk_live_`, or any change to the two human accounts.
- Copying secrets into bolt.diy GitHub secrets; `bolt/prd` stays empty.
- Model picker; OpenRouter key remains a reference.
- Gas City; `resolved` on a question stays false.
- iPhone/WebKit; COEP stays `credentialless`, COOP `same-origin`.
- Changing the generated Bolt UI; the test consumes the existing test ids.

## Risks

| Risk                                                 | Mitigation                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `clerk.signIn` ticket flow blocked by Turnstile      | `clerkSetup()` Testing Token; fall back to Backend API `sign_in_tokens` plus `__clerk_testing_token` query param. |
| `/api/chat` turn in CI depends on OpenRouter latency | 2-min step timeout for the assistant reply; the failure is reported as a model-timeout, not a HITL failure.       |
| WebContainer in headless Chromium                    | No assertion depends on the preview iframe.                                                                       |
| Bot resets the humans' project                       | Job is manual or post-deploy only; summary says when it ran.                                                      |
| Secret in logs                                       | `set +x`, Doppler values exported by the existing masked script, scripts print kinds and counts only.             |
