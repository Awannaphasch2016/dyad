# Deploy Forma in Dev

> Revised 2026-10-08. This is a plan. It does not start a container.

## Summary

Forma gets a public walkthrough URL by running the container that is already on `Awannaphasch2016/forma` `main` (`c7f4fadb8f8b43d56e148920b594c12109bd1ee1`). That image is the Next.js app. It listens on port 3000. The database is Neon project `divine-credit-21002460`. The address is `https://pr-<n>.anakwannaphaschaiyong.com`.

The app reads `DATABASE_URL`. Doppler `forma/dev` currently stores that Neon URL under `WEWEBPLUS_DATABASE_URL`. The Dev job copies the value into `DATABASE_URL` and does not print it.

The model credential is `OPENROUTER_API_KEY` on `forma/dev`. The four OpenAI names are not used.

## Environment

Dev is the hosted stage. The mechanism inside it is one checkout of `forma` `main`, one image built from that repo's `Dockerfile`, one Compose project, and one hostname `pr-<n>.anakwannaphaschaiyong.com`, on Devbox `Wewebplus-ci`.

Canary and Production are unchanged. This plan does not SSH, does not use `/opt/gascity/weaver-plus`, and does not use Neon `proud-salad-68182047`.

## The container

`main` has `Dockerfile`, `.dockerignore`, and `compose.dev.yml`.

The image build is:

```dockerfile
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
EXPOSE 3000
CMD ["pnpm", "run", "start"]
```

`pnpm run build` is `next build`. `pnpm run start` is `next start`. `compose.dev.yml` publishes `3000:3000` and does not set environment variables. The Dev command supplies the env file at runtime and does not commit it.

`pnpm run build` does not migrate. `vercel-build` does, and the Dockerfile does not call `vercel-build`. Before `next start`, a one-shot in the same image runs `scripts/migrate.ts`. That script reads `DATABASE_URL`, applies `db/schema.sql`, and prints `Database schema ready.`

`lib/database-url.ts` rewrites `sslmode=require` to `verify-full`. It leaves the host as given. `schema.sql` is one multi-statement query, so the one-shot uses the direct host `ep-gentle-night-b3pf8q4y`. The running server uses the pooled host `ep-gentle-night-b3pf8q4y-pooler`.

## What the walkthrough URL is

Success is one line in the deploy log:

```text
forma_url=https://pr-<n>.anakwannaphaschaiyong.com
```

Opening that URL returns HTTP 200 from `next start`. The walkthrough entry is the app's password gate. `APP_URL` is that same origin.

## Deploy path

The job checks out `Awannaphasch2016/forma` at `main`. It downloads Doppler project `forma`, config `dev`, with `DOPPLER_ADMIN_TOKEN`. It does not call `deploy/preview/controller.mjs attach` and does not create a Neon child.

1. **Name the variables the container reads.** `forma/dev` gains `DATABASE_URL` from the existing Neon URL in that config. It also needs `APP_URL`, `APP_PASSWORD`, and `AUTH_SECRET` before the page can sign in. The model credential is `OPENROUTER_API_KEY`, already stored on `forma/dev`. The job stops before `docker build` when `DATABASE_URL`, `APP_PASSWORD`, `AUTH_SECRET`, `APP_URL`, or `OPENROUTER_API_KEY` is missing. Values are not printed. The job does not upload `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, or `OPENAI_WEBHOOK_SECRET`.
2. **Build the image from `Dockerfile`.** The build does not receive `DATABASE_URL`.
3. **Migrate on the direct host, then serve.** The one-shot rewrites the host label `ep-gentle-night-b3pf8q4y-pooler` to `ep-gentle-night-b3pf8q4y`, runs `scripts/migrate.ts`, and requires the log line `Database schema ready.` The server container then receives the pooled `DATABASE_URL`.
4. **Publish port 3000.** `docker compose -f compose.dev.yml up` starts `forma`. The named Cloudflare hostname from `forma/dev` forwards to that port. The Devbox must not contain `/opt/gascity/weaver-plus`.

Compose project `forma-dev` is the runtime state for this deploy. Other preview projects on `Wewebplus-ci` stay up.

## Model credential

`forma/dev` holds `OPENROUTER_API_KEY`. The organizer wrote a Doppler reference on `vibesdk/dev` to the non-production Dyad preview secret of the same name, then copied the resolved value into `forma/dev`. The copy log is [run 37729986267](https://github.com/Awannaphasch2016/dyad/actions/runs/37729986267). It shows `forma_dev_openrouter_shape=openrouter` and shows each OpenAI name as absent. It does not read a production config and does not print the key.

The Forma app's `.env.example` still lists `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, and `OPENAI_WEBHOOK_SECRET`. It does not list `OPENROUTER_API_KEY`. This plan does not copy the OpenRouter value into `OPENAI_API_KEY`. A change in `Awannaphasch2016/forma` has to read `OPENROUTER_API_KEY` and call `https://openrouter.ai/api/v1` before a prompt can run. That change is separate from this deploy.

## Walkthrough

After the log prints `forma_url`:

1. Open `https://pr-<n>.anakwannaphaschaiyong.com`.
2. Sign in with the Dev password from `APP_PASSWORD`.
3. Create one project and send one prompt far enough to see that project record a preview URL.

That is the Dev walkthrough. Gas City gates, Canary, and Production are later plans.

## Manual now, same path later

Today the operator runs this job against `forma` `main` and reads `forma_url` from the log.

Later, CI uses this same job. Canary and the EC2 rollout stay the promotion buttons and are not added here.

## Out of scope

- The Dyad browser bridge, `Dockerfile.gascity`, and `preview.yml`'s Dyad image.
- Bolt, Vibe SDK, and a generalized experiment slot.
- `hitl.py`, the answer closer, and rig `multi tenant HITL`.
- A hostname other than `pr-<n>.anakwannaphaschaiyong.com`.
- Changing Doppler `dyad/prd` or the production host.

## Done when

- [x] `forma/dev` has `OPENROUTER_API_KEY` with shape `openrouter`. The four OpenAI names are absent.
- [ ] The deploy log contains `forma_url=https://pr-<n>.anakwannaphaschaiyong.com`.
- [ ] That URL returns HTTP 200 from this container.
- [ ] The log contains `Database schema ready.` The migrate host is `ep-gentle-night-b3pf8q4y`.
- [ ] The log does not mention `mute-credit-71067312`, `proud-salad-68182047`, or `ep-young-wave-b3cwe0rz`.
