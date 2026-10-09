# Doppler organization for WeWeb Plus

> Written 2026-10-09. A proposal, not a change. Nothing here is applied until the infrastructure in `plans/ec2-access-operation-axi.md` is verified end to end. The migration keeps every current consumer reading the same names from the same place until its replacement is proven.

## What exists today

Three Doppler projects feed this repository. The names below come from the code that reads them, not from the Doppler dashboard.

| Project    | Config                                                        | Who reads it                                                                                                                                                                           | Names it must hold                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dyad`     | `preview`, and `dev` for `EC2_SSH_KEY` (operator, 2026-10-09) | GitHub Actions through the Doppler → GitHub sync (repository secrets); `deploy/preview/formula_ecs.mjs`, `controller.mjs`, `cloudflare_env.mjs` download it again with `DOPPLER_TOKEN` | `EC2_SSH_KEY`, `DOPPLER_TOKEN`, `NEON_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `AWS_PREVIEW_FORMULA_ROLE_ARN`, plus the six runtime names below              |
| `dyad`     | `preview` or `prd`                                            | The production EC2 host: `scripts/gascity/host-wrapper.sh` reads `/etc/doppler/dyad-preview.token` and asks for `prd`; a service token is bound to one config, so the file decides     | `NOVNC_PASSWORD`, `GAS_CITY_HOST_BRIDGE_TOKEN`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `WEWEBPLUS_DATABASE_URL`, `WEWEBPLUS_SECRETS_KEY` (allowlist in `scripts/gascity/write_rollout_env.py`) |
| `aws`      | `dev`                                                         | The EC2 host through `/etc/doppler/aws-dev.token`; `scripts/gascity/setup_formula_role.py` uses it to create the IAM role                                                              | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`                                                                                                                                           |
| `ai-pilot` | `dev`                                                         | Vercel deploy of another app                                                                                                                                                           | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`                                                                                                                                                 |

`hitl-web` on Vercel reads the same Clerk keys and `WEWEBPLUS_DATABASE_URL` from the `dyad` config.

What is wrong with this shape:

- `EC2_SSH_KEY` is in `dyad/dev` while the sync is documented from `dyad/preview`. Whichever config a sync reads, a name outside it never reaches GitHub. `deploy/doppler/manifest.json` therefore lists `preview` then `dev` as sources, and the EC2 check prints which config the sync really comes from.
- One config, `dyad/preview`, plays three roles: the credential set for CI, the runtime environment of the production host, and the template for pull-request previews. A config named `preview` runs production.
- The host wrapper names `prd` while its token file is named `preview`. Whichever config the token is bound to is the one in use. `scripts/gascity/check_host_access.py` prints the real answer once the token is valid.
- `DOPPLER_TOKEN` is a secret stored inside `dyad/preview` whose value is a token that reads `dyad/preview`. It exists so workflows can download the config they already received through the sync. That is the duplication the task asked to avoid.
- AWS credentials live in a second project, so the host needs two tokens and two downloads, and the IAM role setup needs both files.
- There is no place for a per-PR value. Pull requests get a Neon branch, but its URL is computed inside the workflow each run, not recorded anywhere.
- Access cannot be separated. Anyone who can read the production runtime secrets can read the CI SSH key, and the reverse.

## How Doppler is meant to be arranged

From Doppler's documentation ([Workplace Structure](https://docs.doppler.com/docs/workplace-structure), [Configs](https://docs.doppler.com/docs/root-configs), [Branch Configs](https://docs.doppler.com/docs/branch-configs), [Config Inheritance](https://docs.doppler.com/docs/config-inheritance), [Secrets](https://docs.doppler.com/docs/secrets), [Service Tokens](https://docs.doppler.com/docs/service-tokens), [GitHub Actions](https://docs.doppler.com/docs/github-actions)):

- A **workplace** is the organization. There are no folders below it; grouping is by name prefix.
- A **project** is one application or service. Doppler assumes the environments inside a project hold similar sets of names and compares them on every save; the "missing secret" warnings and the "apply to other environments" prompt only make sense inside one application. Limit: 1000 projects.
- An **environment** is a deployment stage (`dev`, `stg`, `prd`, `ci`, `pr`). Each environment has one **root config** with the same slug. Limit: 15 per project. Access is granted per environment, never per branch config.
- A **branch config** (`prd_us`, `pr_123`) inherits every secret of its root config and may override some. A change to the root reaches every branch. Branch configs are created in the dashboard, the CLI, or `POST /v3/configs`, and deleted the same way.
- **Config inheritance** lets a config pull in all secrets of another config, in another project if needed, in a set order; the child's own secrets win. **Secret references** do the same per name: `${SECRET}` in the same config, `${config.SECRET}` across configs, `${project.config.SECRET}` across projects. Cross-project references need a paid plan. A reference whose target vanishes resolves to the literal `${...}` string, so moved secrets must be tracked.
- Doppler's recommendation for shared credentials is a dedicated project per group (`shared-...`), with restricted access, referenced from application projects. "One project per team with an environment per app" is listed as an anti-pattern because of the 15-environment limit and the per-save comparison cost.
- For **ephemeral configs** (pull-request review apps) Doppler says: make a separate environment for them, so a write token scoped to that environment cannot touch anything else, and create one branch config per pull request named after its number.
- A **service token** is read-only and bound to one config. **Service account tokens** can be scoped to a project or an environment and may write; they are what a workflow uses to create and delete per-PR configs.
- The **GitHub Actions sync** copies one config into one repository's (or organization's) Actions secrets and keeps it current; GitHub cannot be read back. Values marked `unmasked` can be synced as variables instead. Multiple syncs from different configs into different GitHub Environments are supported for public repositories.

## Proposed hierarchy

Workplace `WeWeb Plus`. Default project environments set to `dev`, `ci`, `preview`, `prd` so every new application starts with the same shape.

```
shared-platform                 WeWeb Plus-wide credentials; owners only
  dev                           CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, WEWEBPLUS_DATABASE_URL,
                                WEWEBPLUS_SECRETS_KEY, NEON_API_KEY, CLOUDFLARE_API_TOKEN,
                                CLOUDFLARE_ZONE_ID, CLOUDFLARE_ACCOUNT_ID
  prd                           same names, production values

aws                             keep the existing project; its host token is bound to it
  dev                           AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION   (exists)
  prd                           the same three, when production stops using the dev keys

dyad                            the Gas City host and its previews
  dev                           a developer's laptop: references shared-platform.dev
  ci                            what GitHub Actions needs and nothing else:
                                EC2_SSH_KEY, AWS_PREVIEW_FORMULA_ROLE_ARN,
                                DOPPLER_TOKEN = service token for dyad.preview,
                                NEON_API_KEY, CLOUDFLARE_* as references to shared-platform.prd
                                -> read by workflows through the OIDC identity;
                                   a GitHub sync from here is optional
  preview                       root: template for every pull-request preview
                                Clerk, secrets key, Neon project as references; NOVNC_PASSWORD
    preview_pr_123              one per pull request: WEWEBPLUS_DATABASE_URL = Neon branch URL,
                                PREVIEW_HOST, anything else that differs per PR
  prd                           the production host runtime:
                                NOVNC_PASSWORD, GAS_CITY_HOST_BRIDGE_TOKEN,
                                Clerk + database + secrets key as references to shared-platform.prd,
                                AWS_* as references to aws.dev (later aws.prd)
                                -> one service token, /etc/doppler/dyad-prd.token

hitl-web                        the Vercel app; references shared-platform.{dev,prd}
  dev, prd

bolt                            same four environments as dyad when the app arrives
formula                         same; AWS_PREVIEW_FORMULA_ROLE_ARN moves here from dyad.ci
                                once formula has its own workflow and its own IAM role trust
```

Rules that make it hold together:

- A value is typed once. Application configs hold references, not copies, for anything in `shared-platform` or `aws`. Doppler's "Search by Secret Value" finds the copies that remain.
- Each consumer gets one credential bound to what it reads: the host reads `dyad.prd` with a service token; GitHub Actions reads `dyad.ci` through a Service Account Identity (OIDC, nothing stored) via `.github/actions/doppler-oidc`; workflows that need a preview's runtime env read `dyad.preview` (or a `preview_pr_N` branch) with `DOPPLER_TOKEN`. No token can read production and CI at once.
- `ci` is an environment, not a branch of `preview`, so access to it can be granted without granting `preview` or `prd`.
- Production runtime secrets in `dyad.prd` are set to `restricted` visibility. The host does not need a human to see them, and the dashboard stops showing them.
- Secrets that the host must never receive (`EC2_SSH_KEY`) are simply not in `dyad.prd`, so `write_rollout_env.py`'s allowlist becomes a check rather than the only guard.

### Per-pull-request configs

Two ways to give a pull request its own values; they are not exclusive.

**Compute in the workflow (today).** `preview-image.yml` creates the Neon branch and passes its URL into the preview. Doppler holds nothing per PR. Cheap, no extra tokens, and a destroyed PR leaves nothing behind. The cost: a second workflow (wake, exec, formula) that needs the same value must recompute or rediscover it, and an operator cannot see what a PR is running with.

**Record in Doppler (proposed addition).** On PR open, a workflow step with a service-account token scoped to the `preview` environment runs `POST /v3/configs {project: dyad, environment: preview, name: preview_pr_123}`, then sets the PR's values on it. Every other workflow for that PR reads `preview_pr_123`; the branch inherits the template, so only the differing names are set. On PR close, `DELETE /v3/configs`. A write token scoped to the `preview` environment cannot create or change anything in `ci` or `prd`; that is why `preview` is its own environment and not a branch of `dev`. Doppler's own guidance for review apps is exactly this.

Trade-offs: the recorded form adds one service-account token to `dyad.ci`, one API call at open and one at close, and a 15-environment-independent but non-zero number of branch configs (Doppler's config limits are per plan; check the current plan before enabling this for every PR). It gives a visible, auditable, reusable per-PR environment and lets `doppler run` inside the preview container pull its own env.

### Single project with many configs, or many projects

|                    | One project, many configs (`dyad` with `prd_bolt`, `prd_formula`)                                    | One project per application (`dyad`, `bolt`, `formula`)                       |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Access control     | Granted per environment; anyone with `prd` sees every app's `prd_*` branch                           | Granted per project and environment; a Formula operator sees only `formula`   |
| Inheritance        | Root `prd` is shared by all apps, so an app-specific name pollutes the others' "missing secret" view | Shared names go through `shared-platform`; each root holds only its own names |
| Sprawl             | Three projects fewer                                                                                 | One project per app; prefixes keep them adjacent in the list                  |
| Doppler's position | Suited to services of one application that share most names                                          | The documented default: a project is one application or service               |

Recommendation: one project per application. Dyad, Bolt, and Formula are separate deployables with separate hosts, roles, and release cadence. Cross-cutting names live in `shared-platform` and arrive by reference, which is the inheritance the question asks about, without putting three applications under one root config.

## Migration

Every phase adds something beside the current path, verifies it with `ops-axi`, and only then retires the old path. The first two phases are required anyway, because the current sync and host token are both broken.

**Phase 0 — observe.** Restore the sync and the host token as described in `plans/ec2-access-operation-axi.md`. Run `ops-axi ec2 check`. Its result lines name the project and config each host token is really bound to. Record the names (not values) in `dyad/preview` with `doppler secrets --only-names -p dyad -c preview`.

**Phase 1 — add environments, move nothing.** `deploy/doppler/manifest.json` is the source of truth for which names belong to `ci` and `prd`; `deploy/doppler/manifest.test.mjs` fails if an operational workflow reads a secret that is not in `ci`, or if `prd` drifts from `write_rollout_env.py`'s allowlist. `DOPPLER_TOKEN=<cli or service-account token for project dyad> node scripts/doppler/migrate.mjs phase1` creates the `ci` and `prd` environments if they are absent and copies only the manifest names from the first source config that has each one, `preview` then `dev` (raw values, so references stay references). It writes nothing that already exists, deletes nothing, and prints names and counts, never values. `migrate.mjs status` shows the gap first; `migrate.mjs verify` afterwards checks every name is there and that `ci`'s `DOPPLER_TOKEN` really answers for `dyad`/`preview`. `preview` is untouched.

**Phase 2 — point GitHub Actions at `ci`.** The workflows that already use `.github/actions/doppler-oidc` read `ci` directly; for the rest (`preview-formula.yml`, `preview-image.yml`, `preview.yml`) either add the same OIDC step or, if a sync is preferred, create a GitHub Actions sync from `dyad.ci` to this repository. The secret names GitHub receives are the same ones the workflows reference today, so no workflow changes. `DOPPLER_TOKEN` in `ci` is a service token for `dyad.preview`, so the download path in `formula_ecs.mjs` and `controller.mjs` still reaches the preview template. Verify: `ops-axi ec2 check` prints `ec2_ssh_key_source=doppler-oidc` (or `github-secret` with a sync) and `ec2_ssh=ok`.

**Phase 3 — one token for the host.** Create a service token for `dyad.prd`, install it as `/etc/doppler/dyad-prd.token` (root, mode 600). `scripts/gascity/host-wrapper.sh` already prefers that file and falls back to `dyad-preview.token`, and `check_host_access.py` reports `dyad_prd_token=` as `absent` until it exists. The host runs the wrapper from its checkout of `cursor/browser-dyad-ui-bbea`, so that change reaches the host when this branch is merged there. Run one rollout with `ops-axi rollout <sha>`. On the host, compare the names in `/run/gascity-rollout.env` before and after (the wrapper deletes the file on exit; compare inside the run). When the rollout is healthy, remove the old file and the fallback. Values are not printed at any step.

**Phase 4 — shared projects and references.** Create `shared-platform` with `dev` and `prd`, set the Clerk, database, secrets key, Neon, and Cloudflare values there, and replace the copies in `dyad.prd`, `dyad.ci`, and `dyad.preview` with `${shared-platform.prd.NAME}` references. Then replace the AWS copies in `dyad.prd` with `${aws.dev.NAME}` and drop the second download from `host-wrapper.sh`. Verify with a checksum of each computed value on the host (`doppler secrets download ... | sha256sum` per name, computed locally, never printed as a value) before and after. This phase needs cross-project references, which is a paid-plan feature; if the workplace is on the free plan, keep the copies, keep `aws-dev.token`, and stop here.

**Phase 5 — retire `preview` as a runtime source, add per-PR configs.** Once no workflow downloads `dyad.preview` for anything but preview values, trim it to the template names. Add the `preview_pr_N` create/delete steps to `preview.yml` behind a service-account token scoped to the `preview` environment. Create `bolt` and `formula` from the workplace defaults when their deployments exist; move `AWS_PREVIEW_FORMULA_ROLE_ARN` to `formula.ci` at the same time as the role's trust policy moves to that repository and branch.

What not to do:

- Do not rename project `dyad` or `aws`. Service tokens and the host files are bound to them, and `host-wrapper.sh`, `setup_formula_role.py`, and four workflows name them.
- Do not delete `dyad/preview` or any secret in it until the phase that replaces each reader has been verified. The readers are listed in the first table.
- Do not run two GitHub syncs into the same repository at the same time; the second overwrites the first on every change.
- Do not put a per-PR config under `dev` or `prd`; the write token for it would then reach those environments.

## What you can check

- `ops-axi ec2 check` after each phase: the GitHub secrets are present, SSH works, and the host tokens answer `http-200` with the expected `project=` and `config=`.
- `ops-axi formula verify` after Phase 2: `AWS_PREVIEW_FORMULA_ROLE_ARN=present` from the host's view of Doppler.
- `ops-axi formula deploy` after Phase 2: the preview reaches ECS and prints `url=https://...`.
- `ops-axi rollout <sha>` after Phase 3: the host builds and recreates the container with one token.
- In the Doppler dashboard: each `dyad` environment shows no "missing secret" warnings against the others once the per-environment name lists are settled, and "Search by Secret Value" for the Clerk secret returns one location after Phase 4.

## Out of scope

- Applying any of this before the infrastructure in `plans/ec2-access-operation-axi.md` is green.
- Changing the IAM role, the ECS deployment, or the Gas City compose file.
- Doppler enterprise features (SAML, custom roles) beyond service accounts and references.
- Moving `ai-pilot`.
