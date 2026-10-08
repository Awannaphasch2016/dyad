# Doppler project for bolt

Bolt gets its own Doppler project, the same way Forma and vibeSDK already do. The Cloudflare API token already stored in vibeSDK `dev` is the source. This plan only arranges the project, the configs, and the reference. It does not deploy the walkthrough and it does not print secret values.

The walkthrough address is still the preview in [plans/bolt-walkthrough-deploy.md](https://github.com/Awannaphasch2016/dyad/blob/cursor/bolt-walkthrough-deploy-55d6/plans/bolt-walkthrough-deploy.md). This plan replaces that plan’s step that adds the two Cloudflare names by hand on the bolt repository.

The GitHub Action `Bolt Doppler setup` creates this layout. It uses the same repository secret as the Forma setup job, `DOPPLER_ADMIN_TOKEN`. The source project slug is `vibesdk`.

## Project and configs

Project slug: `bolt`.

| Config    | Inheritance    | What it holds                                                             |
| --------- | -------------- | ------------------------------------------------------------------------- |
| `dev`     | root config    | Cloudflare names, plus `OPEN_ROUTER_API_KEY`, as references.              |
| `preview` | inherits `dev` | The same names. This is the config the preview deploy reads.              |
| `prd`     | no inheritance | Empty. Production stays closed until the preview walkthrough is accepted. |

```text
vibeSDK / dev                         existing OpenRouter key
  CLOUDFLARE_API_TOKEN                (vibeSDK, Dyad, or Forma dev/preview)
  CLOUDFLARE_ACCOUNT_ID                        |
        |                                      | Doppler reference
        | Doppler reference                    v
        v                               bolt / dev
bolt / dev                              OPEN_ROUTER_API_KEY
        |
        | inherits
        v
bolt / preview  --->  Worker secret OPEN_ROUTER_API_KEY
```

`bolt` / `prd` is not on that path.

## Names

Write these names in `bolt` / `dev`:

- `CLOUDFLARE_API_TOKEN` = `${vibesdk.dev.CLOUDFLARE_API_TOKEN}`
- `CLOUDFLARE_ACCOUNT_ID` = `${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID}`
- `OPEN_ROUTER_API_KEY` = a reference to the existing OpenRouter key

Bolt reads `OPEN_ROUTER_API_KEY` on the Worker. The source may be stored as `OPENROUTER_API_KEY`. The setup job looks in vibeSDK `dev`, then Dyad `dev` and `preview`, then Forma `dev` and `preview`, then any other non-production config. It follows a reference to its root. It does not read `prd`.

If `vibesdk` / `dev` stores either name with the trailing underscore used by the Dyad tunnel config, the setup job references that name instead. Doppler does not allow a reference to a reference. When the vibeSDK value is already a reference, bolt points at the root secret.

A names-only download of vibeSDK `dev` is the first check. It confirms both names are present. It does not print values.

## Token permission

The referenced token has to be allowed to deploy Workers in the Cloudflare account that will host bolt. Confirm that in the Cloudflare token settings, still without copying the value into git, chat, or the Dyad project.

If that token is limited to the vibeSDK Worker, create a second token in the same Cloudflare account with Workers deploy permission and store it only in `bolt` / `dev`. Leave the vibeSDK value unchanged.

The Dyad preview tunnel token stays on the preview host. It is the token for `pr-<n>.anakwannaphaschaiyong.com`. Bolt’s Wrangler deploy uses the vibeSDK Workers token.

## What stays put

- `dyad` keeps Clerk, the database URL, and the Gas City bridge token.
- `aws` keeps the Bedrock keys.
- `forma` stays its own project.
- vibeSDK `dev` keeps the original Cloudflare values. Bolt references them.
- The OpenRouter key stays in the project that already holds it. Bolt `dev` only stores a reference, under the name the Worker reads.

## How the preview job receives them

Doppler `bolt` / `preview` is the source of truth. The deploy job in this repo reads the Cloudflare names and `OPEN_ROUTER_API_KEY` with `DOPPLER_ADMIN_TOKEN` while the job is running. Wrangler deploys the Worker, then stores `OPEN_ROUTER_API_KEY` as a Worker secret. Nothing is copied into GitHub secrets on `Awannaphasch2016/bolt.diy`.

The chat route already passes the Worker env into the OpenRouter provider. With that secret set, choosing OpenRouter calls OpenRouter. The browser does not need a pasted key.

Bolt’s own Preview Deployment workflow only looks at GitHub secrets, so that workflow stays unused for this walkthrough.

## Done when

- Project `bolt` has configs `dev`, `preview`, and `prd`.
- A names-only download of `bolt` / `preview` shows `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `OPEN_ROUTER_API_KEY` non-empty.
- `prd` has none of those names.
- The preview Worker has the OpenRouter secret, and the preview URL comes from the job that read `bolt` / `preview`.
