# Clerk sign-in

wewebplus uses Clerk for the renderer login. The secret key never leaves the main process.

## Keys

Copy `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from Doppler into `.env`. Do not commit `.env`.

The renderer asks main for the publishable key on `clerk:get-publishable-key`. Main returns the value only when it starts with `pk_test_` or `pk_live_`. A missing key, or a secret key placed in the publishable slot, leaves the app ungated: home and factory routes stay open, and the title bar has no Sign in control.

## Routes

Public: `/`, `/sign-in`, `/sign-up`. Sign-in and sign-up are their own page: no title bar, sidebar, or chat tabs. Google returns the browser to `/sign-in/sso-callback` (sign-up uses `/sign-up/sso-callback`). Those paths render the same Clerk component. The widget mounts only after Clerk is ready; until then the page says it is finishing sign-in.

The packaged Electron renderer loads scripts from relative `./assets` URLs. A static HTTP server that falls back to `index.html` has to rewrite those to `/assets` in the document it sends. Otherwise a full load of `/sign-in/sso-callback` requests `/sign-in/assets`, gets HTML back, and the page stays blank.

Sign-in required: `/chat`, `/apps`, `/app-details`, `/library`.

A signed-in reviewer or dev can open Admin read-only. Only the admin role can invite members or change roles. Approve buttons on Discovery, Implementation, and Delivery follow the same role permissions. Main verifies the Clerk session token before those mutations when both Clerk keys are set.

## Accounts

Enable Organizations in the Clerk dashboard. Each signed-in person has a private account and can belong to organizations. The title-bar switcher chooses the active account. A role (`admin`, `reviewer`, or `dev`) is stored on the organization membership, not on the user. The private account's owner is an admin and has no member list.

Set `WEWEBPLUS_DATABASE_URL` to the Postgres control plane and `WEWEBPLUS_SECRETS_KEY` to encrypt GitHub and Supabase tokens saved for an account. Control-plane tables live in the `wewebplus` schema, so they can share a database that already has other tables. Both the URL and the key stay in the main process. If either Clerk key or the database URL is missing, wewebplus keeps the current ungated local app.

The person who creates an organization is its owner and admin. Other people join only when that admin invites them by email. The iPad bridge keeps its Clerk session apart from the Electron window, so a signed-out desktop window does not clear the Safari sign-in.

Private rows are visible only to that user. Organization rows are the same rows for every member. A private account and an organization do not share apps: an app stays in the account that created it. Deleting it removes that shared row. The switcher saves the last account on the Clerk user, so the next sign-in on iPad or Electron restores it. Signing out ends the session. App folders stay on the device. A second device clones them when the account has a GitHub connection; otherwise the files panel says the project files are on the machine that created them. Chat text and the tool transcript follow the app after a turn finishes.

## Safari tunnel

Allow the current Cloudflare quick-tunnel hostname in the Clerk dashboard for each session. Hostnames rotate, so a fixed host cannot be the only test target. Sign-in, reload, and sign-out need a pass on iPad Safari, not only localhost. Safari ITP and Clerk dev-browser cookies are the usual failure mode.
