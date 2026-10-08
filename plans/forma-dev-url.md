# Deploy Forma in Dev

> Revised 2026-10-08. This is a plan. It does not start a container.

## Summary

Forma gets a public walkthrough URL by running the container that is already on `Awannaphasch2016/forma` `main` (`c7f4fadb8f8b43d56e148920b594c12109bd1ee1`). That image is the Next.js app. It listens on port 3000. The database is Neon project `divine-credit-21002460`. The address is `https://pr-<n>.anakwannaphaschaiyong.com`.

The app reads `DATABASE_URL`. Doppler `forma/dev` currently stores that Neon URL under `WEWEBPLUS_DATABASE_URL`. The Dev job copies the value into `DATABASE_URL` and does not print it.

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

1. **Name the variables the container reads.** `forma/dev` gains `DATABASE_URL` from the existing Neon URL in that config. It also needs `APP_URL`, `APP_PASSWORD`, and `AUTH_SECRET` before the page can sign in, and `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, and `OPENAI_WEBHOOK_SECRET` before a prompt runs. The job stops before `docker build` when `DATABASE_URL`, `APP_PASSWORD`, `AUTH_SECRET`, or `APP_URL` is missing. Values are not printed.
2. **Build the image from `Dockerfile`.** The build does not receive `DATABASE_URL`.
3. **Migrate on the direct host, then serve.** The one-shot rewrites the host label `ep-gentle-night-b3pf8q4y-pooler` to `ep-gentle-night-b3pf8q4y`, runs `scripts/migrate.ts`, and requires the log line `Database schema ready.` The server container then receives the pooled `DATABASE_URL`.
4. **Publish port 3000.** `docker compose -f compose.dev.yml up` starts `forma`. The named Cloudflare hostname from `forma/dev` forwards to that port. The Devbox must not contain `/opt/gascity/weaver-plus`.

Compose project `forma-dev` is the runtime state for this deploy. Other preview projects on `Wewebplus-ci` stay up.

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

- [ ] The deploy log contains `forma_url=https://pr-<n>.anakwannaphaschaiyong.com`.
- [ ] That URL returns HTTP 200 from this container.
- [ ] The log contains `Database schema ready.` The migrate host is `ep-gentle-night-b3pf8q4y`.
- [ ] The log does not mention `mute-credit-71067312`, `proud-salad-68182047`, or `ep-young-wave-b3cwe0rz`.
