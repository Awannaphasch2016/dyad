# Doppler project for bolt

Bolt gets its own Doppler project, the same way Forma and vibeSDK already do. The Cloudflare API token already stored in vibeSDK `dev` is the source. This plan only arranges the project, the configs, and the reference. It does not deploy the walkthrough and it does not print secret values.

The walkthrough address is still the preview in [plans/bolt-walkthrough-deploy.md](https://github.com/Awannaphasch2016/dyad/blob/cursor/bolt-walkthrough-deploy-55d6/plans/bolt-walkthrough-deploy.md). This plan replaces that plan’s step that adds the two Cloudflare names by hand on the bolt repository.

The GitHub Action `Bolt Doppler setup` creates this layout. It uses the same repository secret as the Forma setup job, `DOPPLER_ADMIN_TOKEN`. The source project slug is `vibesdk`.

## Project and configs

Project slug: `bolt`.

| Config    | Inheritance    | What it holds                                                             |
| --------- | -------------- | ------------------------------------------------------------------------- |
| `dev`     | root config    | The two Cloudflare names, as references to vibeSDK `dev`.                 |
| `preview` | inherits `dev` | The same two names. This is the config the preview deploy reads.          |
| `prd`     | no inheritance | Empty. Production stays closed until the preview walkthrough is accepted. |

```text
vibeSDK / dev
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
        |
        | Doppler reference, same value
        v
bolt / dev
        |
        | inherits
        v
bolt / preview  --->  Awannaphasch2016/bolt.diy repository secrets
```

`bolt` / `prd` is not on that path.

## Names

Write these two names in `bolt` / `dev`:

- `CLOUDFLARE_API_TOKEN` = `${vibesdk.dev.CLOUDFLARE_API_TOKEN}`
- `CLOUDFLARE_ACCOUNT_ID` = `${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID}`

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
- A model key is not added. On the preview site, one key is entered in bolt’s settings in the browser.

## How the preview job receives them

Doppler `bolt` / `preview` is the source of truth. The deploy job in this repo reads those two names with `DOPPLER_ADMIN_TOKEN` while the job is running and passes them to Wrangler. They are not copied into GitHub secrets on `Awannaphasch2016/bolt.diy`.

Bolt’s own Preview Deployment workflow only looks at GitHub secrets, so that workflow stays unused for this walkthrough.

## Done when

- Project `bolt` has configs `dev`, `preview`, and `prd`.
- A names-only download of `bolt` / `preview` shows `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` non-empty.
- `prd` has neither name.
- The preview URL comes from the job that read `bolt` / `preview`.
