# Formula pages for three phases

First iteration: three plain-text formula pages. Each page edits one phase. This plan does not add the pages yet.

Web builders stay unwired until these pages work. Cooking and running beads stay on the GasCity host. The preview workflow does neither.

## What this iteration does

| In this iteration | Later |
| --- | --- |
| Discovery, Implementation, and Delivery pages | Connecting the saved formulas to DYAD, Forma, Bolt, or Vibe SDK |
| Validate, save, reload, and undo on each page | Cooking or running beads from the preview |
| History of each save in the preview database | A diff instead of the full text, or a Durable Object |
| | A visual formula editor |

GitHub Actions deploys the pages inside the existing `dyad` preview container. The pages edit formula text. GasCity keeps the current file and, later, creates and runs the beads.

## Two stores

A formula edit touches two places. They do different jobs.

| Store | What it holds | Who reads it |
| --- | --- | --- |
| `<cityRoot>/formulas/<name>.toml` on the GasCity host | The current formula text | GasCity's compiler, `gc formula show`, and a later cook |
| `wewebplus.formula_revisions` in the preview Postgres | One row per successful save: phase name, time, and the full text | The formula page, for reload and undo |

GasCity's SQLite `beads` table is the work created by a cook. A formula edit does not write a row there. Beads already cooked from an older file stay as they are. The new text applies to the next cook.

The three files are:

| Page | File | `formula` name inside the file |
| --- | --- | --- |
| Discovery | `<cityRoot>/formulas/discovery.toml` | `discovery` |
| Implementation | `<cityRoot>/formulas/implementation.toml` | `implementation` |
| Delivery | `<cityRoot>/formulas/delivery.toml` | `delivery` |

The preview database is the Neon branch the preview deploy already attaches. The table is new. `wewebplus.audit_events` is not the history. It records an action, not the formula text.

The preview container's `/city` volume is empty and is not the GasCity city. The page saves by calling a running GasCity supervisor. If that address is missing, the page shows the error and does not write a local file.

## The three pages

One page per phase. Same layout on each.

1. Open the page.
2. Load the current text from `GET /v0/city/{city}/formulas/{name}/source`. When that file does not exist yet, show a short starter. The starter is written only when the user saves.
3. Edit the text.
4. Validate. See below.
5. Save. The save writes the GasCity file and appends one history row with the full text.
6. Reload shows the saved text.
7. Undo writes the previous history row back through the same save path, which replaces the GasCity file and appends that older text as a new row.

An edit on one page does not change the other two files or their history.

Each starter is a normal v2 formula. Steps use the fields GasCity already has: `id`, `title`, `description`, `needs`, and `metadata.gc.run_target` when a step names an agent. The TOML key `phase` is left unused. In GasCity that key means `liquid` or `vapor`, not these three phases.

```toml
formula = "discovery"
description = "Discovery"

[requires]
formula_compiler = ">=2.0.0"

[[steps]]
id = "discover"
title = "Discover"
description = "Explore the request."
```

## What validate proves

The page calls `POST /v0/city/{city}/formulas/{name}/validate` with the raw TOML. That parses the file, runs GasCity's `Validate`, checks that the `formula` name matches the page, and resolves `extends`. It writes nothing and creates no beads.

A broken file shows the errors and is not saved. The previous GasCity file and the history stay as they were. The broken cases for this iteration are:

- The `formula` name is missing, or it does not match the page.
- A step is missing `id` or `title`.
- `needs` names a step that does not exist.

A misspelled key such as `dependson` is accepted and ignored. That is not the broken-file test. `gc.run_target` is copied through as text. Validate does not check that the name is a live agent.

`POST .../validate` does not run the full compiler. A dependency cycle can pass it. After a successful save, `gc formula show <name>` on the GasCity host is the compile check. It prints the recipe, including `workflow-finalize`, and creates nothing. GitHub Actions does not run it.

A green validate and a successful `gc formula show` mean the file can be stored and compiled. They do not mean an agent will finish the work.

## How a page saves

- `GET /v0/city/{city}/formulas/{name}/source` loads the current file.
- `POST /v0/city/{city}/formulas/{name}/validate` checks the draft.
- `PUT /v0/city/{city}/formulas/{name}` replaces `<cityRoot>/formulas/<name>.toml`.

Writes use GasCity's existing `X-GC-Request` header, and `X-GC-City-Write` when that city requires a grant. The PUT rejects the same problems validate rejects. Only after the PUT succeeds does the page insert the history row.

The pages do not call cook, sling, bead create, or bead close.

## Where the pages are deployed

The pages ship inside the existing `dyad` service (`Dockerfile.gascity`, `compose.preview.yml`). `preview-image.yml` builds or reuses that image and `preview-up.sh` starts it. `preview-wake.yml` only starts containers that are already there.

The preview URL is `https://pr-<n>.anakwannaphaschaiyong.com`. The preview image does not contain `gc`. The preview workflow does not cook or sling. `gascity-rollout.yml` is not how these pages are deployed.

`preview-image.yml` on this base publishes only for `cursor/preview-bridge-proof-9e7a`. The implementation branch has to be allowed to publish the same `dyad` image. That change still must not cook or sling.

## What "working" means

On the preview URL:

1. Discovery, Implementation, and Delivery each have their own page.
2. Each page loads its own text.
3. An edit on one page leaves the other two files and their history unchanged.
4. A valid formula saves. Reload shows that text. One new `wewebplus.formula_revisions` row holds the same text.
5. A broken formula, using one of the cases above, is rejected. The GasCity file and the history stay as they were.
6. Undo on a page restores the previous text in the editor, in the GasCity file, and as a new history row.
7. No web builder reads these files.
8. The preview log does not cook or sling.

On the GasCity host, after the three files are saved:

1. `gc formula show discovery` prints the compiled steps and `discovery.workflow-finalize`. The same for `implementation` and `delivery`. No beads are created.
2. A dependency cycle is rejected by `gc formula show` even when the page's validate call accepted it.

After those checks pass, a later change can point a web builder at the saved files, or cook and sling them on the GasCity host. That later change is not part of this iteration.
