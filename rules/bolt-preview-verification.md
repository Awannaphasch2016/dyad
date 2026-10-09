# Bolt preview verification

The shared Bolt walkthrough is not ready for review until the `verify` job in `.github/workflows/bolt-preview-from-doppler.yml` has run against the deployed worker.

## Handback

- Report `functional=passed` only when that job is green.
- When the job fails, name the failed step and link the `bolt-preview-verification` artifact (screenshots, videos, traces, `summary.txt`).
- The job always lists `generated-website`, `visual-regression`, and `agentic-ux`. Those layers stay unverified or not run until a check actually asserts them. Do not describe them as passing.
- If Doppler, Clerk, or the browser cannot run, say the walkthrough was not verified and why. Do not fill the gap with a manual click-path for the reviewer to try first.

## Testing contract

`WALKTHROUGH_EXPECTATIONS` and `FUNCTIONAL_STEPS` in `scripts/doppler/bolt-preview-verify.mjs` are the pass criteria.

- Do not edit those strings, the reset SQL, or the role checks to make a red run pass.
- A product change that renames a button or moves a role must update the contract in a separate, obvious diff. The unit test fails when the product labels drift from the contract.
- Do not satisfy the job by weakening Playwright into a model that chooses its own clicks.

## What this job does

- It resets `wewebplus` app `bolt-walkthrough`: answers, questions, messages, and `project_state` go back to Discovery. Memberships, the app row, and the chat row stay. Say that a run replaces the shared preview people may already be viewing.
- It signs in the existing Project Manager and Developer with short-lived Clerk sign-in tokens (`strategy: "ticket"`). Development keys only. Stop on `sk_live_` or `pk_live_`. Never log a token.
- It does not open Google or Microsoft, and it does not complete Microsoft Authenticator.
- Two browser contexts stay isolated. The job checks who can send, who can answer, who can move each phase, and that both downloads match and contain the Developer answer.
- Playwright on the GitHub-hosted runner is the functional gate. Do not add Browserbase, Stagehand, Skyvern, Momentic, mabl, or QA Wolf unless an account is already available. A model's opinion of the layout is not a pass gate.
