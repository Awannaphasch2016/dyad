# Clerk sign-in

wewebplus uses Clerk for the renderer login. The secret key never leaves the main process.

## Keys

Copy `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from Doppler into `.env`. Do not commit `.env`.

The renderer asks main for the publishable key on `clerk:get-publishable-key`. Main returns the value only when it starts with `pk_test_` or `pk_live_`. A missing key, or a secret key placed in the publishable slot, leaves the app ungated: home and factory routes stay open, and the title bar has no Sign in control.

## Routes

Public: `/`, `/sign-in`, `/sign-up`. Sign-in and sign-up are their own page: no title bar, sidebar, or chat tabs. Google returns the browser to `/sign-in/sso-callback` (sign-up uses `/sign-up/sso-callback`). Those paths render the same Clerk component. The widget mounts only after Clerk is ready; until then the page says it is finishing sign-in.

The packaged Electron renderer loads scripts from relative `./assets` URLs. A static HTTP server that falls back to `index.html` has to rewrite those to `/assets` in the document it sends. Otherwise a full load of `/sign-in/sso-callback` requests `/sign-in/assets`, gets HTML back, and the page stays blank.

Sign-in required: `/chat`, `/apps`, `/app-details`, `/library`.

A signed-in reviewer or dev can open Admin read-only. Only the admin role can invite members or change roles. Approve buttons on Discovery, Implementation, and Delivery follow the same role permissions. These checks are renderer UX. Main does not yet verify the Clerk session on those mutations.

## Safari tunnel

Allow the current Cloudflare quick-tunnel hostname in the Clerk dashboard for each session. Hostnames rotate, so a fixed host cannot be the only test target. Sign-in, reload, and sign-out need a pass on iPad Safari, not only localhost. Safari ITP and Clerk dev-browser cookies are the usual failure mode.
