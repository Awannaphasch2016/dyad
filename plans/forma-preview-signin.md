# Forma preview sign-in

> This is a plan. It does not change the preview and it does not deploy.

## Summary

"Open workspace" fails with "Request origin is not allowed." The password is not checked. After this plan, the same page accepts `APP_PASSWORD` from Doppler `forma/dev` and shows the studio. The send button stays disabled.

## Why the button fails

`POST /api/auth` calls `sameOrigin` in `lib/http.ts` before it reads the password.

```javascript
const expected = process.env.APP_URL || new URL(request.url).origin;
if (request.headers.get("origin") !== expected)
  throw new HttpError(403, "Request origin is not allowed.");
```

The browser origin is the address in the bar, `https://forma-d647f6r2a-anak2.vercel.app`. The preview stored `APP_URL` as `https://forma-preview.vercel.app` before that address existed. Those strings differ, so Forma returns 403.

A later deployment gets a new `forma-<id>-anak2.vercel.app` host. Saving one host into `APP_URL` fails again on the next deploy. The fix accepts the host the browser called.

## What you can do after sign-in

The studio replaces the password card. The project list is empty. The composer is visible. The banner says setup is in progress. Send stays disabled because `GET /api/status` is `{"configured":false}`.

`missingConfig()` still requires `OPENAI_API_KEY`, `OPENAI_EXECUTOR_API_KEY`, `OPENAI_AGENT_ID`, and `OPENAI_WEBHOOK_SECRET`. `OPENROUTER_API_KEY` is already on the preview and does not satisfy those names. Creating a generated app is a later change.

## Scope

### In scope

- Allow `POST /api/auth` when the `Origin` host equals the `Host` of that request.
- Keep rejecting a missing `Origin` and an `Origin` whose host is different.
- Remove the placeholder `APP_URL` from the preview environment. Do not write the next deployment's host into `APP_URL`.
- Redeploy the walkthrough commit and comment the new URL on https://github.com/Awannaphasch2016/forma/pull/2.
- Confirm a wrong password returns 401, then you sign in with `APP_PASSWORD`.

### Out of scope

- Copying `OPENROUTER_API_KEY` into any `OPENAI_*` name.
- Enabling Send, creating a project, or running a Vercel Sandbox build.
- Neon project `proud-salad-68182047`, host `ep-young-wave-b3cwe0rz`, and Doppler `dyad/prd`.
- The Vercel project named `dyad`.

## Phases

### 1. Accept the deployment host

In `Awannaphasch2016/forma`, on the walkthrough branch:

- `sameOrigin` allows the request when `Origin` is present and its host equals the request `Host`.
- An `Origin` equal to `APP_URL` is still allowed.
- A missing `Origin`, and an `Origin` from another site, still throw "Request origin is not allowed."
- `tests/core.test.ts` covers the matching host, a different host, and a missing origin.
- The commit is on the Forma walkthrough branch. It is not merged to Forma `main` from this plan.

### 2. Stop storing the placeholder

In the Dyad preview runner:

- Delete the preview-target `APP_URL` whose value is `https://forma-preview.vercel.app`.
- The next deploy does not set `APP_URL`.
- `APP_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, `OPENROUTER_API_KEY`, and `DATABASE_URL` stay. The four OpenAI names stay unset.
- Redeploy the walkthrough commit to the existing Vercel project `forma`.

### 3. Prove sign-in, then walk the studio

- `POST /api/auth` with `Origin` set to the new deployment origin and a password that is not `APP_PASSWORD` returns 401, "That password is incorrect."
- You open the commented URL. The card says "Enter your workspace password to get started."
- You enter `APP_PASSWORD` from Doppler project `forma`, config `dev`. The card closes.
- The studio shows the composer and the setup banner. Send is disabled.
- `GET /api/status` is still `{"configured":false}`.

## Done when

- [ ] The password card accepts `APP_PASSWORD` on the URL commented on Forma pull request 2.
- [ ] A request whose `Origin` host is not that deployment is still rejected.
- [ ] The studio is visible and Send is disabled.
- [ ] The log does not contain the password, `APP_URL`'s old placeholder as a stored value, or a database URL.
