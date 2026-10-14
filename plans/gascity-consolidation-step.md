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

OpenCode is not installed. `OPENROUTER_API_KEY` is in Doppler `dyad` / `preview` and is not in this process environment. The localhost adapter that runs `gc sling` is not written. The city at `/tmp/dyad-city` is stopped and was cooked for Claude. Those are the next step, after the operator items below. The walk PRs land before that sling.

## Operator items

Read from `.github/workflows/doppler-organize.yml` on `cursor/axi-toolbox-image-plan-531e`, `deploy/doppler/manifest.json` on that same branch, `deploy/preview/render.mjs`, `scripts/gascity/write_rollout_env.py`, `scripts/gascity/preview-up.sh`, and `.github/workflows/preview-image.yml`.

### Before this step

Reply `go`. This step needs no secret and no workflow click.

Do not paste `DOPPLER_TOKEN`, Clerk keys, or AWS keys. Preview already receives `secrets.DOPPLER_TOKEN`. This step does not call preview.

Do not dispatch Doppler organize. A dispatch from this agent returned HTTP 403. The workflow on `cursor/axi-toolbox-image-plan-531e` logs in with OIDC (`vars.DOPPLER_SERVICE_IDENTITY_ID`) and runs `node scripts/doppler/migrate.mjs` as `status`, `phase1`, or `verify`. It prints names and counts, never values. A push on that branch runs `status` only.

The manifest project is `dyad`. Its `ci` names are `AWS_PREVIEW_FORMULA_ROLE_ARN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DOPPLER_TOKEN`, `EC2_SSH_KEY`, and `NEON_API_KEY`. Its `prd` names are `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `GAS_CITY_HOST_BRIDGE_TOKEN`, `NOVNC_PASSWORD`, `WEWEBPLUS_DATABASE_URL`, and `WEWEBPLUS_SECRETS_KEY`. That list is what organize copies. It is not the full preview config.

`OPENROUTER_API_KEY` is present on Doppler project `dyad`, config `preview`. Bolt Doppler setup run [37734422368](https://github.com/Awannaphasch2016/dyad/actions/runs/37734422368) on 2026-10-08 printed `dyad.preview=OPENROUTER_API_KEY` and `openrouter_source=${dyad.preview.OPENROUTER_API_KEY}`. Run [37759462055](https://github.com/Awannaphasch2016/dyad/actions/runs/37759462055) printed the same name later that day. The setup job found the name and stored a reference. It did not create the secret. The log does not say who added it. `GAS_CITY_ORCHESTRATOR_URL` is still absent from the printed names. The 2026-10-10 organize status counted 27 preview names and printed only the copy list, which is why the first pass missed OpenRouter.

`deploy/preview/render.mjs` exports only `WEWEBPLUS_DATABASE_URL`, `WEWEBPLUS_SECRETS_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_ACCOUNT_ID`. `scripts/gascity/write_rollout_env.py` keeps `NOVNC_PASSWORD`, `GAS_CITY_HOST_BRIDGE_TOKEN`, the Clerk pair, the Wewebplus pair, and the AWS triple, then writes fixed bridge settings. Both drop any other Doppler name. `preview-image.yml` passes `secrets.DOPPLER_TOKEN` into the Cloudflare name report and `deploy/preview/controller.mjs attach` for the Neon preview branch. `scripts/gascity/preview-up.sh` records that the city volume is empty and this image does not run `gc`.

### Before the live run, after this step

1. The OpenRouter value stays in Doppler `dyad` / `preview` under `OPENROUTER_API_KEY`. Paste nothing. This machine still has no Doppler token, so the city process gets the value from a job that already fetches that config, the same fetch as `.github/workflows/dyad-bridge-signin.yml`.
2. Optional: an OpenRouter model slug that accepts tool calls. If omitted, the city uses a tool-capable Claude model on OpenRouter.
3. Confirmed. One operator answers Discovery and Delivery as `project-manager` and Implementation as `developer`. #155 fails the check when the role is missing.
4. The walk below drives those clicks. It is included before the sling. A click unblocks a GasCity bead only after Approve posts `human_gate.verdict` and `human_gate.role`, and after Submit answer posts the reply onto the paused bead.

## Remote execution is a GitHub Actions workflow

The operator surface is [PR #92](https://github.com/Awannaphasch2016/dyad/pull/92), branch `cursor/axi-toolbox-image-plan-531e`. `packages/ops-axi` starts a workflow, waits, and reads the `key=value` lines. It holds no Doppler or AWS credential. The next slice opened on that PR adds the workflows in the second table to `packages/ops-axi/lib/catalog.js`. `ops-axi run <file> --ref <branch>` can already start one that has no named command.

GitHub dispatches a workflow file only when that file is on the default branch. These files live on feature branches, so a dispatch from this agent returns HTTP 403 or "Workflow does not have workflow_dispatch trigger". `ops-axi` then reruns the latest run on that ref.

Named commands already on PR #92:

| Command          | Workflow                   | What the job does                                                                                            |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ec2 check`      | `ec2-access-check.yml`     | Prove Actions can reach the EC2 host and the host's Doppler tokens. Prints names and fingerprints.           |
| `formula role`   | `preview-formula-role.yml` | Create the formula preview OIDC role from the EC2 host and store its ARN in Doppler.                         |
| `formula verify` | `ec2-access-check.yml`     | From the host, require `AWS_PREVIEW_FORMULA_ROLE_ARN` present.                                               |
| `formula deploy` | `preview-formula.yml`      | Deploy the formula pages to ECS and print the URL.                                                           |
| `doppler status` | `doppler-organize.yml`     | OIDC into Doppler and report `dyad` against `deploy/doppler/manifest.json`. `status`, `phase1`, or `verify`. |
| `rollout <sha>`  | `gascity-rollout.yml`      | SSH the Gas City host forward after CI. The short-lived Doppler token is not written to disk.                |

Remote workflows on that same branch with no named command yet:

| Workflow                | What the job does                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `axi-toolbox-image.yml` | Build `ghcr.io/awannaphasch2016/axi-toolbox`. It does not dispatch, SSH, or hold a Doppler token.         |
| `preview-image.yml`     | Publish the Dyad image and update the shared preview from Devbox `Wewebplus-ci`.                          |
| `preview.yml`           | Create, update, or destroy one preview from the preview label.                                            |
| `preview-exec.yml`      | Run a preview on the shared Devbox.                                                                       |
| `preview-wake.yml`      | Start the existing preview containers after the Devbox stops cloudflared.                                 |
| `preview-secrets.yml`   | Print the Devbox public key so controller credentials can be sealed. The private key stays on the Devbox. |

Remote workflows on this branch, also for that next slice:

| Workflow                  | What the job does                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `dyad-bridge-signin.yml`  | One Dyad process, two Playwright browsers. Fetches Doppler `dyad` / `preview` by OIDC, including `OPENROUTER_API_KEY`. |
| `hitl-cursor-probe.yml`   | Read `CURSOR_API_KEY` from `dyad` / `preview` and call the Cloud Agents API.                                           |
| `hitl-cursor-factory.yml` | Run the Cursor factory poller with that key. The agent request has no env block.                                       |

`ui-walk.yml` is described in [PR #162](https://github.com/Awannaphasch2016/dyad/pull/162) and is not a file yet. It joins this list when the file exists.

## One walk

The two walks are the same loop with different selectors. [PR #128](https://github.com/Awannaphasch2016/dyad/pull/128) is the Vibe loop: the `hitl` job in `preview-vibesdk.yml` runs `e2e-vibesdk/tests/two-roles.spec.js`. The Project Manager types the start prompt. The Developer’s Enter does not start an app. The loop polls `org-question`. The other role sees `org-waiting` and not the question text. The reply is one sentence from OpenRouter, typed into the last textarea. There is no Approve button. The loop stops after answers and three quiet minutes.

This branch’s Dyad loop is `dyad-bridge-signin.yml` running `e2e-bridge/two-roles.spec.ts`. Both roles sign in with Clerk. The Project Manager creates the app through IPC. The loop walks Discovery, Implementation, and Delivery. A question is `hitl-question-*`. The reply is the echo `Recorded from the question: …`. Approve and continue is enabled only for `project-manager` on Discovery and Delivery and only for `developer` on Implementation. `DYAD_FACTORY_SCRIPT=record` makes `factory_phase_controller.ts` invent the question and the `## Phase finished` summary.

#162 already generalizes them: one workflow `ui-walk.yml`, one runner `e2e-walk/walk.mjs`, one config per app. `vibesdk.json` reproduces the Vibe loop. `dyad.json` adds the phase bar, Submit answer, Approve, and Send back. The job holds the browsers and the Clerk tickets. One decider returns the reply. The Dyad config is the single agent UI walk for Dyad.

The walker clicks the window. It does not sling. The recorded Northwind script stays out of the shared runner. A click unblocks a bead only after Submit answer and Approve write that bead.

Operator AXI is the remote executor. A Cursor cloud agent looks up an `ops-axi` command when the work runs on Doppler, ECS, EC2, Devbox, or this walk. It does not perform that call from the agent VM.

## Finished catalog

A finished `packages/ops-axi` has these commands. The first six exist on PR #92. The rest are the ones that slice adds. CI, review bots, the CLA, stale-PR closers, and `release.yml` stay automatic. They are not commands.

| Use case                                                    | Command                     | Workflow                                                |
| ----------------------------------------------------------- | --------------------------- | ------------------------------------------------------- |
| Prove Actions can reach the EC2 host and its Doppler tokens | `ops-axi ec2 check`         | `ec2-access-check.yml`                                  |
| Roll the Gas City host to a commit                          | `ops-axi rollout <sha>`     | `gascity-rollout.yml`                                   |
| Report Doppler project `dyad` against the manifest          | `ops-axi doppler status`    | `doppler-organize.yml` with `command=status`            |
| Copy manifest names into the `ci` and `prd` configs         | `ops-axi doppler phase1`    | `doppler-organize.yml` with `command=phase1`            |
| Check that copy                                             | `ops-axi doppler verify`    | `doppler-organize.yml` with `command=verify`            |
| Store the formula preview role ARN                          | `ops-axi formula role`      | `preview-formula-role.yml`                              |
| Require that ARN present                                    | `ops-axi formula verify`    | `ec2-access-check.yml`                                  |
| Deploy the formula pages to ECS                             | `ops-axi formula deploy`    | `preview-formula.yml`                                   |
| Publish the Dyad image and update the shared preview        | `ops-axi preview image`     | `preview-image.yml`                                     |
| Open or update the Devbox preview for a pull request        | `ops-axi preview up <pr>`   | Adds the `preview` label, which starts `preview.yml`    |
| Remove that preview                                         | `ops-axi preview down <pr>` | Removes the `preview` label, which starts `preview.yml` |
| Prove GitHub can run a preview on the Devbox                | `ops-axi preview exec`      | `preview-exec.yml`                                      |
| Start preview containers after cloudflared stops            | `ops-axi preview wake`      | `preview-wake.yml`                                      |
| Seal the Devbox controller key                              | `ops-axi preview secrets`   | `preview-secrets.yml`                                   |
| Publish the toolbox image                                   | `ops-axi toolbox image`     | `axi-toolbox-image.yml`                                 |
| Drive the Dyad window through one config                    | `ops-axi walk dyad`         | `ui-walk.yml` with `e2e-walk/configs/dyad.json`         |
| Drive the Vibe window through the same runner               | `ops-axi walk vibe`         | `ui-walk.yml` with `e2e-walk/configs/vibesdk.json`      |
| Prove the Cursor key in `dyad` / `preview`                  | `ops-axi cursor probe`      | `hitl-cursor-probe.yml`                                 |
| Run the Cursor factory poller once                          | `ops-axi cursor factory`    | `hitl-cursor-factory.yml`                               |

`preview up` and `preview down` label the pull request. `preview.yml` has no `workflow_dispatch`. `ui-walk.yml` is the file PR #162 adds. Until that file exists, `ops-axi walk dyad` has no workflow to start. `dyad-bridge-signin.yml` is the recorded Northwind walk and is not the finished command.

## Preview paths besides the Devbox

`preview.yml`, `preview-image.yml`, `preview-exec.yml`, `preview-wake.yml`, `preview-secrets.yml`, and `preview-control.yml` run on Devbox `Wewebplus-ci`. These do not:

| Path             | Host                                                                                                  | Workflow                                                       | Start                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Formula pages    | ECS cluster `wewebplus-formula-preview`, service `formula-preview`, one task, ALB in `ap-southeast-1` | `preview-formula.yml`                                          | `ops-axi formula deploy`                                                                  |
| Vibe SDK         | Cloudflare Worker `vibesdk-pr-<n>.karant-test-egress-canary.workers.dev`                              | `preview-vibesdk.yml` on `cursor/vibesdk-org-prompt-hitl-0539` | Label `preview-vibesdk`                                                                   |
| Bolt walkthrough | Cloudflare Worker `bolt-walkthrough-55d6`                                                             | `bolt-preview-from-doppler.yml` on `cursor/bolt-doppler-55d6`  | Dispatch or push on that branch                                                           |
| Forma            | Vercel preview in Forma’s own project                                                                 | `preview-forma.yml` and `pr-preview-forma.yml`                 | `workflow_dispatch` with a Forma SHA or PR, or `repository_dispatch` type `preview-forma` |

The formula HTTPS plan stays on that same ECS service. `gascity-image.yml` publishes a GHCR image and does not start a host. `wewebplus-preview-image.yml` publishes the preview CLI image and does not run Dyad. `preview-vercel-db.yml` points pull request 20’s Neon branch at a Vercel Preview environment, and that job still logs into the Devbox.

## Read-only command in each group

Each group has one command that prints facts and changes nothing. A failed deploy is debugged by running that command, not by repeating the deploy.

| Group                          | Read-only command                | What it prints                                                    | Write command it stays away from                                    |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Host                           | `ops-axi ec2 check`              | Actions can reach the host. Doppler token names and fingerprints. | `ops-axi rollout <sha>`                                             |
| Host, still missing            | `ops-axi host status`            | The commit the EC2 host is running.                               | `ops-axi rollout <sha>`                                             |
| Doppler                        | `ops-axi doppler status`         | Environment names and which manifest names are present.           | `ops-axi doppler phase1`                                            |
| Doppler, after a copy          | `ops-axi doppler verify`         | The copy matches the manifest.                                    | `ops-axi doppler phase1`                                            |
| Formula on ECS                 | `ops-axi formula verify`         | `AWS_PREVIEW_FORMULA_ROLE_ARN` is present.                        | `ops-axi formula role`                                              |
| Formula on ECS, still missing  | `ops-axi formula status`         | Service active, desired count 1, task health, URL.                | `ops-axi formula deploy`                                            |
| Devbox preview                 | `ops-axi preview status <pr>`    | Container state from `preview-control.yml` action `status`.       | `ops-axi preview up <pr>`                                           |
| Devbox preview                 | `ops-axi preview logs <pr>`      | Recent logs. Action `logs`.                                       |                                                                     |
| Devbox preview                 | `ops-axi preview db-status <pr>` | Neon branch presence. Action `db-status`.                         |                                                                     |
| Vibe Worker, still missing     | `ops-axi vibe status <pr>`       | HTTP status of the `workers.dev` URL.                             | The label that deploys                                              |
| Bolt Worker, still missing     | `ops-axi bolt status`            | HTTP status of `bolt-walkthrough-55d6`.                           | `bolt-preview-from-doppler.yml`                                     |
| Forma on Vercel, still missing | `ops-axi forma status`           | Deployment state for the SHA or PR.                               | `preview-forma.yml`                                                 |
| Toolbox                        | `ops-axi toolbox status`         | Published digest and tag. The image workflow only builds today.   | `ops-axi toolbox image`                                             |
| Walk                           | `ops-axi walk status`            | Last walk conclusion and artifact names.                          | `ops-axi walk dyad`                                                 |
| Cursor key                     | `ops-axi cursor probe`           | `GET /v1/me`, then one plan-mode agent that is deleted.           | `ops-axi cursor factory` stays out. It runs the old factory poller. |

## Doppler project and config on every command

A stage is a Doppler config. The same command runs against `dev`, `preview`, or `prd` by naming that config. The workflow file stays one file.

```sh
ops-axi preview status 177 --project dyad --config preview
ops-axi preview status 177 --project dyad --config dev
```

The default is the pair that command uses today, so a call with no flags keeps the current behavior. The job prints `project=` and `config=` before it reads secrets. A write refuses to run when its flags are omitted and it has no default.

Two workflows already read two configs, so those commands take two pairs. `hitl-cursor-probe.yml` reads `dyad` / `preview` and `aws` / `dev`. `scripts/gascity/host-wrapper.sh` reads `dyad` / `prd` and `aws` / `dev`. `dyad-bridge-signin.yml` reads `dyad` / `preview` only.

| Command                                                     | Default                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `preview status`, `preview up`, `preview logs`, `walk dyad` | `--project dyad --config preview`                                          |
| `rollout`, `host status`                                    | `--project dyad --config prd` and `--aws-project aws --aws-config dev`     |
| `cursor probe`                                              | `--project dyad --config preview` and `--aws-project aws --aws-config dev` |
| `formula deploy`, `formula status`                          | `--project dyad --config preview`                                          |
| `doppler status`                                            | `--project dyad`, then the manifest's source configs                       |
| `bolt status`                                               | `--project bolt --config preview`                                          |

## New Cursor sessions

This repo has no `.cursor/environment.json`. A new agent session gets `ops-axi` only when the cloud environment's `install` copies it onto the snapshot. An already running session keeps the disk it booted with.

`install` runs once per environment build, as a login shell, and new sessions boot from that snapshot. Put the binaries on the default `PATH`:

```sh
digest=sha256:49e83dc64a665870cb28ab55a10ef63b2e2df7369519f4c02086cfdfb5e28b12
id="$(docker create ghcr.io/awannaphasch2016/axi-toolbox@${digest})"
docker cp "$id:/opt/axi/bin/ops-axi" /usr/local/bin/ops-axi
docker cp "$id:/opt/axi/bin/gh-axi" /usr/local/bin/gh-axi
docker rm "$id"
chmod 755 /usr/local/bin/ops-axi /usr/local/bin/gh-axi
gh-axi setup hooks
```

That digest is the published image that carries `packages/ops-axi`. The image has no Doppler or GitHub token. The session's `GH_TOKEN` is what `ops-axi` uses to start workflows.

`ops-axi toolbox use <digest>` is the version command. It checks the image exists, replaces `/usr/local/bin/ops-axi` and `gh-axi` from that image, and writes the digest into the `install` pin. Other sessions see it after the next environment build. `gh-axi update` inside the image does nothing useful: `/opt/axi` is owned by root and the image runs as `agent`.

The readable-output skill is `unslop`, by Lauren Tan (`poteto`) in the `pstack` plugin. It cuts AI tells from writing. The code sibling is `deslop` in `cursor-team-kit`. A copy of `unslop` lives at `.claude/skills/unslop/SKILL.md`, which `.agents/skills` already links. Its current file sets `disable-model-invocation: true`, so a session runs it when asked. `poteto-mode` is the skill that applies `unslop` to prose on its own.

What the environment keeps, and what the checkout keeps:

| Kept by                                 | What                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Environment `install`, then a new build | `ops-axi`, `gh-axi`, the `gh-axi` hooks, Docker, Node, and `gh` on `/usr/local/bin` |
| The git checkout                        | `unslop`, the repo skills under `.claude/skills`, `AGENTS.md`, and `rules/`         |
| The Cursor account, not the snapshot    | The `pstack` plugin, if installed from the marketplace                              |
| Injected per session                    | `GH_TOKEN`. It is not written into the snapshot.                                    |
| GitHub Actions, not this VM             | Doppler. `ops-axi` starts the workflow that reads it.                               |

`install` ends by running `ops-axi --help` and checking that `.claude/skills/unslop/SKILL.md` exists, so a bad copy fails the build. Pulling the toolbox image needs `ghcr.io` on the environment egress list.

## Implementation list

Two slices. The first lands on PR #92, in `packages/ops-axi`. The second is the cloud environment for this repo. Neither slice slings a formula.

### ops-axi

1. Keep the six commands already in `packages/ops-axi/lib/catalog.js`: `ec2 check`, `formula role`, `formula verify`, `formula deploy`, `doppler status`, `rollout`.
2. Add `doppler phase1` and `doppler verify` as catalog entries that pass `command` to `doppler-organize.yml`.
3. Add `--project` and `--config` to every command, plus `--aws-project` and `--aws-config` where a command reads a second pair. The default is the pair that command uses today. The job prints `project=` and `config=` before it reads secrets. A write with no default and no flags exits without changing anything.
4. Pass those flags into the workflow as inputs. Replace the hardcoded `doppler-project` and `doppler-config` values in the workflows this catalog starts.
5. Add the Devbox commands: `preview image`, `preview up <pr>`, `preview down <pr>`, `preview exec`, `preview wake`, `preview secrets`. `preview up` and `preview down` add or remove the `preview` label and then watch `preview.yml`.
6. Add the read-only commands whose workflows already exist: `preview status <pr>`, `preview logs <pr>`, and `preview db-status <pr>` call `preview-control.yml` with `action` set to `status`, `logs`, or `db-status`.
7. Add the read-only commands that need a new workflow, each of which prints facts and changes nothing: `host status`, `formula status`, `vibe status <pr>`, `bolt status`, `forma status`, `toolbox status`, `walk status`.
8. Add `toolbox image` for the existing build workflow, and `toolbox use <digest>` to replace `/usr/local/bin/ops-axi` and `gh-axi` and write that digest into the install pin.
9. Add `cursor probe`. Leave `cursor factory` out.
10. Add `walk dyad` and `walk vibe` only after `ui-walk.yml` and the two config files exist. Until then the catalog has no walk command.
11. Extend `packages/ops-axi/test` with the fake `gh`. Cover the new names, the Doppler defaults, a write that refuses to run, and `preview up` adding the label.
12. Publish a new toolbox image from that commit. `ops-axi toolbox status` prints the digest. Later sessions pin that digest.

### Cursor cloud environment

1. Add `.cursor/environment.json`. Its `install` reads one pin file, copies `ops-axi` and `gh-axi` from that digest into `/usr/local/bin`, and runs `gh-axi setup hooks`.
2. The same pin file is what `ops-axi toolbox use <digest>` writes. `install` and `toolbox use` do not each keep a copy of the digest.
3. `install` checks `ops-axi --help` and `.claude/skills/unslop/SKILL.md`. A missing binary or a missing skill fails the build.
4. The environment image includes Docker, Node, and `gh`. Egress allows `ghcr.io`.
5. Leave `GH_TOKEN` and every Doppler value out of the snapshot. The session injects `GH_TOKEN`. Doppler stays inside the workflow the command starts.
6. `unslop` stays in git at `.claude/skills/unslop/SKILL.md`. The environment does not keep a second copy.
7. Build the environment from that commit. A new session is the check: `ops-axi --help` prints the catalog, and the `unslop` skill file is on the checkout. A session that is already running is not that check.

### Its own repository

`ops-axi` gets its own repository. The toolbox image builds from that repository. A catalog entry names the repository that owns the workflow, so a Dyad preview command still starts `Awannaphasch2016/dyad` and a Forma command starts the Forma repository. An agent on any repository installs the same binary from the image.

### Open a pull request on another repository

No workflow in this repo opens a pull request on another repository. `DYAD_GITHUB_APP_ID` is used by the review and stale-PR workflows. Those tokens request `contents: read` and `pull-requests: write`, and the scripts pass `context.repo`, which is this repository.

The command is `ops-axi pr open <owner>/<repo>`. It dispatches one workflow in the ops-axi repository. That workflow uses a GitHub App installed on the repositories the account wants agents to write. The app needs contents write and pull requests write on each of those repositories. The cloud agent's `GH_TOKEN` only needs permission to dispatch that one workflow. The agent does not receive a token that can push to the other repository.

## Walk, before the sling

Two pull requests are the agent UI walk. Both land before a formula sling.

| PR                                                        | Branch                                | What it is                                              |
| --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| [#160](https://github.com/Awannaphasch2016/dyad/pull/160) | `cursor/composer-bar-factory-9b9b`    | The composer the walk clicks. Base is #155.             |
| [#162](https://github.com/Awannaphasch2016/dyad/pull/162) | `cursor/superpowers-git-ui-plan-9b9b` | The driver plan. Base is #160. `plans/ui-walk.md` only. |

#160 puts an open question in the composer (`FactoryComposerQuestion`). The waiting line is `hitl-wait-*`. The addressed role sees `hitl-body-*`, types in the box, and presses Submit answer. That calls `ipc.factory.answerQuestion`. The other role does not see the body. Approve and Send back stay on the phase bar. Discovery and Delivery approve as Project Manager. Implementation approves as Developer. On that branch Approve still calls `ipc.factoryHost.approvePhase`, `ipc.factory.approve`, and `ipc.factory.ensureCursorPhase`. Those write the Dyad phase machine. They do not write `human_gate.verdict` or `human_gate.role`.

#162 describes `ui-walk.yml`, `e2e-walk/walk.mjs`, and `e2e-walk/configs/dyad.json`. Those files are not in the branch. The engine it names is the two-browser loop from [PR #128](https://github.com/Awannaphasch2016/dyad/pull/128) (`e2e-vibesdk/tests/two-roles.spec.js`) and the Cursor create/poll/delete client in `hitl-cursor-probe.yml`. The job holds the browsers and the Clerk tickets. A Cursor Cloud Agent reads the question that is on screen and returns the reply. `dyad.json` sets Submit answer, Approve, and Send back, with `project-manager` for Discovery and Delivery and `developer` for Implementation.

The walk that already runs on this branch is `.github/workflows/dyad-bridge-signin.yml` plus `e2e-bridge/two-roles.spec.ts`. It signs in two Clerk browsers, fills `Recorded from the question: …`, and clicks Approve and continue. `DYAD_FACTORY_SCRIPT=record` makes `factory_phase_controller.ts` invent the Northwind question and the `## Phase finished` summary. That path does not call `gc sling`. Its approval row is `factory_phase_approvals`. A GasCity clarify bead and a `human_gate` bead stay open.

So the walk can drive the window. It can answer a pause and click a gate once those controls write the bead. It cannot do that today. The scripted recorder and #160 both stop at the Dyad tables. #162 is the driver shape to keep, and it stays a plan until the verdict and the answer post exist.
