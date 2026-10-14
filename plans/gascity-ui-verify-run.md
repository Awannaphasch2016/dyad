# Drive a formula run on the three-phase window

Status: plan only. The three phase chats are the window. [PR #172](https://github.com/Awannaphasch2016/dyad/pull/172) paints a bead when an event arrives. Nothing in that pull request starts GasCity, and the preview image does not run `gc`.

## Important points

1. You watch Discovery, Implementation, and Delivery. That is the whole window for this check.
2. One prompt slings `speckit-phased` once. The guest session posts each bead. The window moves when that bead's event arrives.
3. Secret names are updated by the existing **Doppler organize** workflow. `status` reads. `phase1` copies a missing name from `preview` or `dev`. `verify` checks the manifest. The log prints names and counts.
4. `GAS_CITY_ORCHESTRATOR_URL` is the name this walk needs and the manifest does not list. It is added only when `status` already finds it in a source config. `phase1` then copies it.
5. The preview process must receive that URL. Today `preview-up.sh` and `write_rollout_env.py` leave it out, so a send cannot reach the city.
6. The formula pages at `/formulas/discovery` are a different screen. They are not this check.

## What you open

The app with the three buttons: Discovery, Implementation, Delivery. The step title sits on that bar. The message list is the chat for the open phase.

[Preview formula](https://github.com/Awannaphasch2016/dyad/actions) keeps `/formulas/discovery`, `/formulas/implementation`, and `/formulas/delivery` on ECS. That workflow's own note says the log does not sling. Those pages are not the three phase chats.

`scripts/gascity/preview-up.sh` prints `City volume pr-<pr>-city is empty; this image does not run gc`. Opening that preview shows the window. It does not walk the formula until a city is attached.

## What the city does

Dyad already posts this when you send on a linked factory app:

```json
{
  "type": "sling",
  "formula": "speckit-phased",
  "appId": 1,
  "chatId": 2,
  "prompt": "...",
  "taskId": "gas-city-run:..."
}
```

The URL is `GAS_CITY_ORCHESTRATOR_URL`. A missing URL fails the send. The city compiles `speckit-phased`, runs each ready bead in a guest session, and posts events to the host bridge with `stepId`. The bridge token is `GAS_CITY_HOST_BRIDGE_TOKEN`, which `dyad/prd` already lists.

You then see:

| Bead                                     | Phase chat     | What you look at                                                                      |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `requirements` through `decompose`       | Discovery      | That bead's text. The bar title changes with the bead.                                |
| `accept-discovery`                       | Discovery      | Streaming stops. **Approve and continue** is enabled. Implementation has no new text. |
| Your click                               | Discovery      | The window stays on Discovery. The city receives `verdict: approve`.                  |
| `implement` and `review`                 | Implementation | The window moves here and shows that bead's text.                                     |
| `accept-implementation`                  | Implementation | Delivery stays locked.                                                                |
| `finalize`, `accept-delivery`, `publish` | Delivery       | Delivery is finished only after `publish` and `type: end`.                            |

## Doppler

Use the workflow **Doppler organize** (`.github/workflows/doppler-organize.yml` on `cursor/axi-toolbox-image-plan-531e`). It logs in with the OIDC identity `vars.DOPPLER_SERVICE_IDENTITY_ID` and runs `scripts/doppler/migrate.mjs`. A push of that workflow runs `status`. `phase1` runs when the Actions input is `phase1`, or when the commit message contains `[doppler:phase1]`. `verify` runs after `phase1`.

`deploy/doppler/manifest.json` on that branch is the list. Project `dyad`. Sources `preview`, then `dev`. Environments:

| Environment | Names                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`        | `AWS_PREVIEW_FORMULA_ROLE_ARN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DOPPLER_TOKEN`, `EC2_SSH_KEY`, `NEON_API_KEY` |
| `prd`       | `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `GAS_CITY_HOST_BRIDGE_TOKEN`, `NOVNC_PASSWORD`, `WEWEBPLUS_DATABASE_URL`, `WEWEBPLUS_SECRETS_KEY`        |

`phase1` creates a missing environment and copies each missing manifest name from the first source that has it. A name already set is left alone. A name in neither source is reported as `absent_in_sources` and is not invented. `verify` prints `missing=` and `extra=` counts. The job prints no values.

For this walk:

1. Run **Doppler organize** with `status`.
2. If `GAS_CITY_ORCHESTRATOR_URL` is in `preview` or `dev`, add it to the manifest environment the preview reads, on the branch the workflow checks out, and run `phase1`, then `verify`.
3. If `status` reports that name in neither source, stop. Enter the value in the Doppler source config, then run `status` again and `phase1`. The value stays in Doppler.
4. Model keys for the guest session stay with GasCity. They are not added to `dyad/prd` for this check.

Do not add a second Doppler workflow. Do not put the URL in a GitHub secret by hand for this check.

## Pass the URL into the window

Two writers drop the name today.

- `scripts/gascity/preview-up.sh` copies database, Clerk, and AWS names into the preview env file. It does not copy `GAS_CITY_ORCHESTRATOR_URL`.
- `scripts/gascity/write_rollout_env.py` keeps an allowlist. `GAS_CITY_ORCHESTRATOR_URL` is not on it, so a host rollout drops it even after Doppler has it.

Add the name to both, the same way the existing names are copied. The scripts still do not print values. `GAS_CITY_HOST_BRIDGE_ENABLED`, the bridge host, and the bridge port stay as they are.

The city at that URL must reach the preview's bridge with `GAS_CITY_HOST_BRIDGE_TOKEN` and post `/v1/apps/:appId/phases/:phase/events`.

## Order

1. **Doppler status.** Run **Doppler organize** `status`. Record which source holds `GAS_CITY_ORCHESTRATOR_URL`, or that neither does.
2. **Copy the name.** Manifest edit on `cursor/axi-toolbox-image-plan-531e`, then `phase1` and `verify`. Stop when the source does not have the value.
3. **Hand the name to the preview.** `preview-up.sh` and `write_rollout_env.py` pass it through.
4. **Open the three phase chats** on a preview built from the paint branch, [PR #172](https://github.com/Awannaphasch2016/dyad/pull/172). Link the factory app. Send one prompt on Discovery.
5. **Watch.** The listener or `gc session logs` shows one sling of `speckit-phased`. The window follows the table above. The main log for that turn does not enter `handleLocalAgentStream`.

## Out of scope

- Playing the beads from a button inside Dyad.
- Treating `/formulas/discovery` as the proof window.
- A preview image that embeds `gc` when the city URL is unset.
- Printing or committing Doppler values.
- A new Doppler project layout. `plans/doppler-organization.md` stays the layout proposal. This check uses the organize workflow that already runs.
