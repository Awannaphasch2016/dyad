# preview-forma workflow

> This branch is the plan. The workflow file is on `cursor/preview-forma-workflow-5014`. This branch does not rename the repository.

This repository is the orchestrator for the agentic dev workflow. The Dyad application stays here until that workflow is stable. Moving Dyad, Bolt, or Vibe SDK is a later refactor.

## Verify

Check these in order. A line is done only when the observable result is true.

- [ ] This repository's Actions list shows one workflow named `preview-forma`. Its file is `.github/workflows/preview-forma.yml`. A second Forma deploy workflow is not present.
  - The execution branch file is `.github/workflows/preview-forma.yml` and its `name:` key is `preview-forma`. GitHub still lists that path as **Forma preview** (workflow 378171026) until the file is on the default branch. **PR Preview - Forma** (workflow 378313467) stays listed because `cursor/forma-pr-preview-5014` still contains `.github/workflows/pr-preview-forma.yml`.
- [ ] `Awannaphasch2016/forma` does not contain `preview-forma`. Forma's own Actions workflow remains **Publish Forma image**.
  - This token cannot list the private Forma repository. The deploy log said `forma_image_workflow=present` and `forma_image=unavailable`.
- [x] A run with no commit SHA and no Forma pull request number fails before Doppler, Neon, or Vercel. It does not deploy `cursor/forma-preview-walkthrough`.
  - Run [37801804857](https://github.com/Awannaphasch2016/dyad/actions/runs/37801804857) logged `forma_environment=preview` and `A Forma commit SHA or pull request number is required`, then exited. It had no Doppler, Neon, or Vercel lines.
- [x] A run names one full Forma commit SHA in the log. The Vercel URL is that commit. `GET /api/status` is `{"configured":true,"provider":"openrouter"}`. A wrong password returns 401.
  - Run [37802103230](https://github.com/Awannaphasch2016/dyad/actions/runs/37802103230) logged `forma_sha=80a8e419f6285378b4dfada336ea8213f3089bab`, `forma_source=commit`, and `forma_url=https://forma-p2q19xkaj-anak2.vercel.app`. The log and a later request both got status `configured=true` `provider=openrouter` and auth `401`.
- [x] The run reads Doppler project `forma` config `dev`, uses Neon branch `forma-pr-<number>` in project `divine-credit-21002460` under parent `br-round-night-b33xeq5p`, and deploys to the Vercel project `forma`. `APP_URL` is unset. `OPENROUTER_API_KEY` is not copied into any `OPENAI_*` name.
  - The same run logged `forma_vercel_source=forma/dev`, `forma_branch=present forma-pr-2`, and host `ep-twilight-wildflower-b3fwtiew`. It updated `OPENROUTER_API_KEY` and did not update `APP_URL` or any `OPENAI_*` name. The branch already existed, so the parent id was not printed; the script refuses any parent other than `br-round-night-b33xeq5p` before it uses the branch.
- [x] The Forma pull request comment shows the Vercel URL and the commit SHA.
  - After printing the URL, the job posted that comment and exited 0. A failed `gh pr comment` fails the job. This token cannot read the private pull request back.
- [x] An environment other than `preview` is refused before Doppler, Neon, or Vercel.
  - `FORMA_ENVIRONMENT=canary node scripts/gascity/forma-preview.mjs` exits 1 with `Only the preview environment is implemented` and does not reach Doppler. Dispatch from this token is forbidden, so this check is the script the workflow runs, not a second Actions run.
- [ ] Adding the label `preview-forma` on a pull request in `Awannaphasch2016/forma` does not start this workflow.
  - The workflow has no pull request or label trigger. The label was not added on the private repository.
- [ ] This repository is still the Dyad repository. Dyad, Bolt, and Vibe SDK are not moved. Closing the Forma pull request does not delete the Neon branch.
  - The repository is still `Awannaphasch2016/dyad`. Forma pull request 2 was not closed, so deletion was not observed. The workflow has no close trigger.

## Already true

- **PR Preview - Forma** (`.github/workflows/pr-preview-forma.yml` on `cursor/forma-pr-preview-5014`) deploys a Forma commit to Vercel. Its last URL before replacement was https://forma-lgm8pihjw-anak2.vercel.app at commit `80a8e419f6285378b4dfada336ea8213f3089bab`.
- That workflow runs only when that branch is pushed, or when someone dispatches it on that branch. Its empty SHA input deploys the walkthrough branch tip.
- Forma owns the sign-in check and the OpenRouter editor. The deploy does not copy `scripts/gascity/forma-openrouter/`.
- Forma has **Publish Forma image**, which builds `ghcr.io/awannaphasch2016/forma:sha-<commit>`. The public URL stays the Vercel deployment. The container is not run.
- `commandForPullRequest` already treats the label `preview-forma` as a different label from `preview`. Nothing calls it for a Forma pull request.
- A label event on the private Forma repository does not reach a workflow in this repository.

## What this plan changes

One workflow in this repository, named `preview-forma`, becomes the Forma deploy. It deploys a Forma pull request's head commit, or an explicit commit SHA. It replaces **PR Preview - Forma** so two workflows do not deploy the same pull request.

The label `preview-forma` stays the name of the workflow. Putting that label on a Forma pull request does not start the job. A later plan can send `repository_dispatch` from Forma. This plan does not add that sender.

## Scope

### In scope

- Add `.github/workflows/preview-forma.yml` in this repository. The Actions name is `preview-forma`.
- Remove `.github/workflows/pr-preview-forma.yml` in the same change, so only one workflow deploys Forma.
- Trigger `workflow_dispatch` with `sha`, `pr`, and `environment`. `environment` defaults to `preview`.
- Accept `repository_dispatch` of type `preview-forma` with the same three fields in `client_payload`.
- When `pr` is set, read that pull request's head SHA from `Awannaphasch2016/forma` and deploy it. When both `pr` and `sha` are set, they must be the same commit.
- When only `sha` is set, deploy that commit. Comment only when `pr` is set.
- Keep the current preview path: Doppler `forma/dev`, Neon `forma-pr-<number>`, Vercel project `forma`, no `APP_URL`, no OpenAI names, no file copy from this repository.
- Comment the Vercel URL and the full SHA on the Forma pull request.
- Log `forma_sha`, `forma_source=commit`, `forma_environment=preview`, and the image tag `ghcr.io/awannaphasch2016/forma:sha-<commit>`.

### Out of scope

- A workflow file in `Awannaphasch2016/forma` other than the existing **Publish Forma image**.
- Starting the job from the `preview-forma` label. Label events do not cross from Forma into this repository.
- Deleting the Neon branch when a pull request closes or the label is removed.
- Renaming this repository, or moving the Dyad application, Bolt, or Vibe SDK.
- Running the Forma image on Devbox or switching the public URL off Vercel.
- Pre-production and production. Any environment other than `preview` is refused.
- Merging this workflow to `main`. The proof run is on the branch that contains the file.
- Doppler `dyad/prd`, Neon project `proud-salad-68182047`, and host `ep-young-wave-b3cwe0rz`.

## Run

1. Open Actions for this repository and choose `preview-forma` on the branch that contains the file.
2. Enter a Forma pull request number, or a full 40-character SHA. Leave environment as `preview`.
3. The log shows `forma_sha=<40 hex>` and `forma_url=https://…`.
4. Open `forma_url`. Wrong password returns 401. `GET /api/status` reports OpenRouter.
5. The Forma pull request comment contains that URL and that SHA.

## Decision log

- The orchestrator stays in this repository. A later refactor can move the Dyad application out. This plan does not start that refactor.
- The workflow name is `preview-forma`, matching the label name already reserved in `commandForPullRequest`. The label is not the trigger.
- One deploy workflow. **PR Preview - Forma** is removed when `preview-forma` is added.
- An empty dispatch must fail. The walkthrough branch is no longer an implicit source.
- `APP_URL` stays unset. Each Vercel deploy has a new host.
- The image tag is logged. The URL you open remains the Vercel deployment of that git SHA.
