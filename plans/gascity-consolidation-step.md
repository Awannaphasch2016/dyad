# Consolidation step: one branch on PR #155

Status: not started. This step assembles the branch. It does not sling, and it does not call Doppler or ECS.

## What this step keeps

PR #155 is the baseline (`cursor/human-role-gate-9b9b`, `9d2becf0`). Its packs and `human-gate-verdict.sh` stay. Discovery and Delivery require `human_gate.role` `project-manager`. Implementation requires `developer`. A missing role fails the check.

This branch already has the phase-machine table in `drizzle/0058_lying_veda.sql` and `src/main/factory_phase_controller.ts`. That is the #142 schema. This step does not cherry-pick #142 again and does not add a second `0058`.

The window comes from these commits, in order:

| Commit       | From | Keep                                           |
| ------------ | ---- | ---------------------------------------------- |
| `c3719f252b` | #146 | Host bridge, tool route, event route           |
| `9a5f52d4f6` | #169 | One `speckit-phased` sling, step id, phase bar |
| `6b4fd8af71` | #172 | Paint the bead's text on that phase chat       |
| `dd9a4e4c5d` | #172 | Format fix those paint files need              |
| `bf34bd3461` | #173 | Approve posts a verdict                        |

Skip #173's plan commits `820fb9c555` and `e5ebd71b01`. They describe the scripted recording.

`9a5f52d4f6` adds `0058_overrated_jack_power.sql` on another branch. Here that number is already `0058_lying_veda.sql`. The formula columns (`formula`, `current_step_id`) land as the next migration from `npm run db:generate`, not as a second `0058`.

The verdict payload gains `role`. #169 posts `verdict` only. #155's script rejects that.

## What this step leaves out

- #142's `## Phase finished` path as the thing that advances a phase. The factory send goes to `gc sling`. The phase-machine table stays in the database.
- The Vibe catalog walker (#165–#170).
- `experiments/sdd/bin/start-worker.mjs` (#99). That run used Cursor `POST /v1/agents`. It is not this launcher.
- #156 and #159. They freeze the GIT Conference score. They run after a sling exists.
- Doppler, the preview image, and ECS.

## Order

1. Stay on this branch, which is #155.
2. Cherry-pick the five commits above. On a drizzle conflict, keep `0058_lying_veda.sql` and generate the formula columns as the next file.
3. Add `role` to the verdict POST: `project-manager` or `developer` for the open gate.
4. `gc formula show speckit-phased` lists the beads, and a Discovery gate bead carries `gc.human_gate.role = project-manager`.
5. `npm run fmt`, `npm run lint`, and `npm run ts` on the touched files. `src/lib/methodologyPacks.test.ts` still passes.

## Done when

- One branch contains the #155 packs and the Dyad sling client.
- One migration journal, with the formula columns after `0058_lying_veda.sql`.
- Approve's payload includes the role #155's script reads.
- No Doppler name was added. No preview workflow was changed.

## After this step, still not done

OpenCode is not installed. `OPENROUTER_API_KEY` is not on this machine. The localhost adapter that runs `gc sling` is not written. The city at `/tmp/dyad-city` is stopped and was cooked for Claude. Those are the next step, after the operator items below.

## Operator items

Read from `.github/workflows/doppler-organize.yml` on `cursor/axi-toolbox-image-plan-531e`, `deploy/doppler/manifest.json` on that same branch, `deploy/preview/render.mjs`, `scripts/gascity/write_rollout_env.py`, `scripts/gascity/preview-up.sh`, and `.github/workflows/preview-image.yml`.

### Before this step

Reply `go`. This step needs no secret and no workflow click.

Do not paste `DOPPLER_TOKEN`, Clerk keys, or AWS keys. Preview already receives `secrets.DOPPLER_TOKEN`. This step does not call preview.

Do not dispatch Doppler organize. A dispatch from this agent returned HTTP 403. The workflow on `cursor/axi-toolbox-image-plan-531e` logs in with OIDC (`vars.DOPPLER_SERVICE_IDENTITY_ID`) and runs `node scripts/doppler/migrate.mjs` as `status`, `phase1`, or `verify`. It prints names and counts, never values. A push on that branch runs `status` only.

The manifest project is `dyad`. Its `ci` names are `AWS_PREVIEW_FORMULA_ROLE_ARN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DOPPLER_TOKEN`, `EC2_SSH_KEY`, and `NEON_API_KEY`. Its `prd` names are `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `GAS_CITY_HOST_BRIDGE_TOKEN`, `NOVNC_PASSWORD`, `WEWEBPLUS_DATABASE_URL`, and `WEWEBPLUS_SECRETS_KEY`. `OPENROUTER_API_KEY` and `GAS_CITY_ORCHESTRATOR_URL` are not in that list.

`deploy/preview/render.mjs` exports only `WEWEBPLUS_DATABASE_URL`, `WEWEBPLUS_SECRETS_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_ACCOUNT_ID`. `scripts/gascity/write_rollout_env.py` keeps `NOVNC_PASSWORD`, `GAS_CITY_HOST_BRIDGE_TOKEN`, the Clerk pair, the Wewebplus pair, and the AWS triple, then writes fixed bridge settings. Both drop any other Doppler name. `preview-image.yml` passes `secrets.DOPPLER_TOKEN` into the Cloudflare name report and `deploy/preview/controller.mjs attach` for the Neon preview branch. `scripts/gascity/preview-up.sh` records that the city volume is empty and this image does not run `gc`.

### Before the live run, after this step

1. Send `OPENROUTER_API_KEY` in chat. Do not commit it. It is not on this machine and it is not in the Doppler manifest.
2. Optional: an OpenRouter model slug that accepts tool calls. If omitted, the city uses a tool-capable Claude model on OpenRouter.
3. Confirm one operator answers each gate as the role that gate names: `project-manager` for Discovery and Delivery, `developer` for Implementation. #155 fails the check when the role is missing. This walk does not open two Clerk browsers.
4. During the walk, click Approve at those three gates, or say that this agent may submit those three verdicts.
