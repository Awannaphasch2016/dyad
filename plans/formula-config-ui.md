# Formula pages for three phases

First iteration: three plain-text formula pages. Each page edits one phase. Web builders are not wired up until these pages work.

This is a plan. It does not add the pages yet.

## Scope

| In this iteration | Later |
| --- | --- |
| A Discovery formula page | Connecting the saved formulas to DYAD, Forma, Bolt, or Vibe SDK |
| An Implementation formula page | Cooking or running beads from the preview |
| A Delivery formula page | A visual formula editor |

GitHub Actions deploys the pages. The pages edit formula text. GasCity keeps the files and, later, creates and runs the beads. The preview workflow does not cook or sling.

## The three pages

One page per phase. Same layout on each.

1. Open the page.
2. Read the plain-text formula.
3. Edit it.
4. Validate it against GasCity's existing formula parser.
5. Save it.
6. Reload the page and see the saved text.

The formula names are fixed:

| Page | File |
| --- | --- |
| Discovery | `<cityRoot>/formulas/discovery.toml` |
| Implementation | `<cityRoot>/formulas/implementation.toml` |
| Delivery | `<cityRoot>/formulas/delivery.toml` |

GasCity already stores city-local formulas at `<cityRoot>/formulas/<name>.toml`. The pages use that path. They do not keep a second copy under a web-builder project.

Each file is a normal v2 formula:

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

`formula` inside the file matches the file name. Steps use the fields GasCity already has: `id`, `title`, `description`, `needs`, and `metadata.gc.run_target` for the agent on that step. The TOML key `phase` is not used for these three phases. That key means something else in GasCity (`liquid` or `vapor`).

If a file does not exist yet, the page shows a short starter with the matching `formula` name. The starter is written only when the user saves.

## How a page saves

The page calls the formula routes GasCity already serves:

- `GET /v0/city/{city}/formulas/{name}/source` loads the text
- `POST /v0/city/{city}/formulas/{name}/validate` checks the text and writes nothing
- `PUT /v0/city/{city}/formulas/{name}` writes `<cityRoot>/formulas/<name>.toml`

Validate and save send the raw TOML. A broken file shows the validator errors and is not saved. Writes use GasCity's existing `X-GC-Request` header, and `X-GC-City-Write` when that city requires a grant.

The pages do not call cook, sling, bead create, or bead close.

## Where the pages are deployed

The pages ship inside the existing `dyad` preview container (`Dockerfile.gascity`, service `dyad` in `compose.preview.yml`). `preview-image.yml` builds or reuses that image and `preview-up.sh` starts it. `preview-wake.yml` only starts containers that are already there.

The preview URL is `https://pr-<n>.anakwannaphaschaiyong.com`. The preview image does not contain `gc`. The preview workflow does not run beads.

## What "working" means

On the preview URL:

1. Discovery, Implementation, and Delivery each have their own page.
2. Each page loads its own text.
3. An edit on one page does not change the other two.
4. A valid formula validates and saves.
5. A broken formula is rejected and the previous file stays as it was.
6. Reload shows the saved text for that phase.
7. No web builder reads these files yet.
8. The preview log does not cook or sling.

After those eight checks pass, a later change can point a web builder at the saved files. That later change is not part of this iteration.
