# Forma preview orchestration

> This is a plan. It does not rename this repository, does not build an image, and does not deploy.

## Verify

Check these in order. A line is done only when the observable result is true.

- [x] The sign-in host check and the OpenRouter editor are commits in `Awannaphasch2016/forma`. This repository does not copy those files during deploy.
- [x] The preview log names one full Forma commit SHA. The Vercel deployment is that commit.
- [ ] Forma’s build publishes `ghcr.io/awannaphasch2016/forma:sha-<commit>` and the log shows the image digest `sha256:…`. The URL you open is still a Vercel URL.
- [x] The workflow **PR Preview - Forma** in this repository accepts that commit SHA and an environment. The environment defaults to `preview`.
- [x] Preview uses Doppler project `forma` config `dev`, Neon branch `forma-pr-<number>` in project `divine-credit-21002460`, and the Vercel project `forma`. `APP_URL` is unset. The OpenRouter key is not copied into any `OPENAI_*` name.
- [x] The Forma pull request comment shows the Vercel URL and the commit SHA.
- [ ] The same SHA can be named again with a different environment and no new image build. That second deploy is not part of this plan.
- [x] This repository is still the Dyad repository. Dyad, Bolt, and Vibe SDK are not moved.

## Evidence

[PR Preview - Forma run 37760424992](https://github.com/Awannaphasch2016/dyad/actions/runs/37760424992) on branch `cursor/forma-pr-preview-5014`.

- `forma_sha=5c8417894bced54ca25123c96fa34b27cce9298b`
- `forma_source=commit`
- `forma_environment=preview`
- `forma_url=https://forma-hs90r9mvg-anak2.vercel.app`
- `GET /api/status` is `{"configured":true,"provider":"openrouter"}`. A wrong password returns 401.
- The job did not copy `scripts/gascity/forma-openrouter/`.
- `forma_image_workflow=unavailable`. The dyad-harness GitHub App installation cannot edit workflow files, so Forma's image workflow was not added and no digest was published. The open URL is still the Vercel deployment.
- Naming an environment other than `preview` is refused in code. A second environment was not deployed.

## Already true

- https://forma-agrrt9od3-anak2.vercel.app signs in and generates a notes app with the OpenRouter key from Doppler `forma/dev`.
- `GET /api/status` there is `{"configured":true,"provider":"openrouter"}`.
- The job that produced that URL lives in this repository, on branch `cursor/forma-preview-per-pr-5014`. It is not in the Forma repository.
- That job copies the OpenRouter editor from `scripts/gascity/forma-openrouter/` onto Forma branch `cursor/forma-preview-walkthrough`, then uploads the source to Vercel. It does not pull an image.
- Forma `main` has a generic Dockerfile. Nothing builds it, and the public URL does not run it.
- Dyad’s own preview already builds `Dockerfile.gascity`, pushes a digest to `ghcr.io`, and deploys that digest. Dev, pre-production, and production are Doppler config names. Nothing promotes one artifact from one environment to the next.

## What this plan changes

Forma owns its source. A commit SHA is the version. The Forma repository publishes an image for that SHA. This repository deploys that SHA to the Vercel preview you already use. The image is published so a later environment can reuse it. This plan does not run the container.

## Scope

### In scope

- Move the sign-in host check and the OpenRouter editor into `Awannaphasch2016/forma` as ordinary commits.
- Stop applying `scripts/gascity/forma-openrouter/` at deploy time once the deployed SHA contains those commits.
- In the Forma repository, build and push `ghcr.io/awannaphasch2016/forma:sha-<full-sha>` on the commit being previewed. Record the registry digest.
- In this repository, one workflow named **PR Preview - Forma**. Inputs are the Forma commit SHA and an environment. The environment defaults to `preview`.
- For `preview`, deploy that git SHA to the existing Vercel project `forma`. Create or reuse Neon branch `forma-pr-<number>` under parent `br-round-night-b33xeq5p`. Read Doppler `forma/dev`. Do not set `APP_URL`.
- Comment the Vercel URL and the commit SHA on the Forma pull request.
- Pass the SHA in by `workflow_dispatch`, or by `repository_dispatch` from the Forma repository. A label event on the Forma repository does not reach a workflow in this repository by itself.

### Out of scope

- Renaming this repository or moving the Dyad application out of it.
- Bolt, Vibe SDK, and Gas City.
- Running the Forma image on Devbox or on the production host.
- Switching the public URL from Vercel to that image.
- Google Container Registry. Dyad’s registry is `ghcr.io`. Changing the registry host later does not change the SHA or the digest.
- Building a different image for pre-production or production.
- Deleting the Neon branch when a pull request closes.
- Doppler `dyad/prd`, Neon project `proud-salad-68182047`, and host `ep-young-wave-b3cwe0rz`.
- Copying `OPENROUTER_API_KEY` into `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, or `OPENAI_WEBHOOK_SECRET`.

## Phases

### 1. Forma owns the running code

- The sign-in host check and the OpenRouter editor are on the Forma commit that will be deployed.
- The deploy job no longer copies files from `scripts/gascity/forma-openrouter/`.
- The new Vercel URL still signs in, `GET /api/status` is `configured: true` and `provider: "openrouter"`, and the notes example generates.

### 2. Forma publishes the image

- A workflow in `Awannaphasch2016/forma` builds the image for that same commit.
- The registry tag is `sha-<full commit sha>`.
- The log prints the digest `ghcr.io/awannaphasch2016/forma@sha256:…`.
- The image contains no database URL and no API key.
- The URL you open is still the Vercel deployment of that commit.

### 3. This repository deploys by SHA

- Workflow name: **PR Preview - Forma**.
- Required input: full Forma commit SHA. Optional input: environment, default `preview`. Optional input: pull request number, used for the Neon branch and the comment.
- `preview` reads Doppler `forma/dev`, uses Neon `forma-pr-<number>` in `divine-credit-21002460`, and deploys the SHA to Vercel project `forma`.
- The job refuses Neon project `mute-credit-71067312`, project `proud-salad-68182047`, parent `br-mute-shadow-b3jxqoho`, and host `ep-young-wave-b3cwe0rz`.
- The pull request comment contains the Vercel URL and the SHA.
- The log contains the SHA and the image digest. It does not contain a secret value.

### 4. Leave room for the next environment

- The workflow signature is `deploy(sha, environment)`.
- `preview` is the only environment this plan runs.
- A later environment is the same SHA, the same image digest, and a different Doppler config, database, and hostname.
- No workflow in this plan promotes an environment by itself.

## Done when

- [ ] Every box under **Verify** is checked.
- [ ] The walkthrough branch is no longer the source of the preview. The deployed SHA is a Forma commit that already contains the OpenRouter editor.
- [ ] https://forma-agrrt9od3-anak2.vercel.app may be replaced by a newer Vercel URL. The replacement still generates.

## Decision log

- This repository stays the orchestration repository for now. Moving Dyad’s application code is a later refactor.
- The version is the git SHA. The image tag records that SHA. The registry digest is what a later pull will pin. The preview runtime stays Vercel because that is the URL that generates today.
- The generic Dockerfile on Forma `main` only runs `pnpm start`. Generation also needs the worker and a Vercel credential for Sandbox. Publishing the image does not switch the preview onto it.
- The registry is `ghcr.io`, the same registry Dyad’s preview already uses. GCR would be a different registry login, not a different version scheme.
- `APP_URL` stays unset. Each Vercel deploy gets a new host, and a saved host blocks the next sign-in.
- OpenRouter stays in `OPENROUTER_API_KEY`.
