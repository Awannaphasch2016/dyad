# Plain-text formula configuration

This is a plan. It does not add a page, a formula file, or a workflow step.

GasCity already has the formula mechanism this UI should use. The first iteration is a configuration page for three formula files. GitHub Actions deploys that page. GasCity compiles the files, creates the work, and runs it.

In GasCity source the unit of work is a **bead**. There is no Beat type. A formula is the method. Applying it materializes beads. In this plan, "create and execute Beats" means GasCity's existing cook and sling of beads. The preview workflow does not do either.

Source checked:

- GasCity `Awannaphasch2016/gascity` at `d47f1d3` (public default branch).
- Dyad `cursor/preview-wake-34-bbea` at `4ec8e9b5`.
- The visual formula editor on `cursor/preview-phase-git-readiness-55d6`. That branch is not this base.

## 1. What exists today

### How a formula is defined

A formula is a TOML file. The current contract is formulas v2, opted in with:

```toml
[requires]
formula_compiler = ">=2.0.0"
```

The file name is `formulas/<name>.toml`. The `formula` string inside the file is the name `gc formula cook` and the HTTP API use. A formula is the method. A bead is one unit of work. A convoy is a graph of related work.

v2 compilation produces a recipe, then instantiation writes:

- a workflow root bead (`gc.kind = workflow`)
- one bead per step, linked by `needs` / `depends_on`
- control beads the orchestrator owns (`workflow-finalize`, and check, retry, drain, or fanout when the formula uses those)

Agents run only the plain work beads. The orchestrator in `internal/dispatch` runs the control beads. That split is already implemented in `internal/formula`, `internal/graphv2`, `internal/molecule`, and `internal/dispatch`.

The TOML key `phase` is not an application phase. It is a legacy v1 storage switch (`liquid` or `vapor`). Discovery, Implementation, and Delivery must be three formula files, not three values of `phase`.

### How a step names its agent

Each `[[steps]]` entry is one bead. The fields GasCity already accepts are enough:

| Field | Role |
| --- | --- |
| `id`, `title` | Required identity |
| `description` | Instructions shown to the agent |
| `needs` | Step ids that must finish first |
| `assignee` | Default assignee |
| `metadata.gc.run_target` | Agent, pool, or role this step routes to |

`gc.run_target` is copied onto the cooked bead as `gc.routed_to`. A second agent is a second step with its own `gc.run_target`. Drain and `on_complete` already fan one step out across many agents. The first formulas should not use those. One step, one `gc.run_target`.

Unknown step keys are ignored. A typo in `needs` drops the dependency with no error. Validation has to come from GasCity's parser, not a hand-written subset.

### How a formula becomes beads

Three existing verbs. None of them belong in the Formula UI or in GitHub Actions.

| Verb | What it does |
| --- | --- |
| `gc formula show <name>` | Compiles and prints the recipe, including the generated `workflow-finalize` step. Creates nothing. |
| `gc formula cook <name>` | Compiles and writes the root and step beads into the current store. Does not route them. Nothing wakes up. |
| `gc sling <target> <name> --formula` | Cooks and routes. For a v2 formula this starts a workflow. The orchestrator then runs it. |

An order can name a formula and a trigger. The orchestrator cooks and routes when the trigger fires. The first iteration does not add an order. Saving a formula file does not cook it. If an order with that name already exists, its next trigger is GasCity's scheduler, not the preview deploy.

### Where the files live

City-local formulas are `<cityRoot>/formulas/<name>.toml`.

`internal/configedit/formulas.go` writes that path atomically. The name must be a flat slug (`^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$`). `discovery`, `implementation`, and `delivery` match. The writer refuses a custom `[formulas].dir`, a symlink, and any path that leaves the city tree.

Resolution is last-wins across layers: imported city packs, then the city's own `formulas/`, then rig packs, then the rig `formulas_dir`. A city-local file of the same name overrides a pack formula. On save, the supervisor refreshes the formula layer snapshot and pokes the reconciler so the new file is discovered. That poke does not cook beads.

Pack formulas are not editable through this writer. `GET .../source` returns "not found" unless a city-local file exists.

### HTTP API the UI should call

Registered in `internal/api/supervisor_city_routes.go`. Implemented in `huma_handlers_formula_write.go` and `huma_handlers_formulas.go`.

| Call | Effect |
| --- | --- |
| `GET /v0/city/{city}/formulas/{name}/source` | Raw TOML of the city-local file |
| `POST /v0/city/{city}/formulas/{name}/validate` | Parse, `Validate`, name match, resolve `extends` against the city layers. No write. |
| `PUT /v0/city/{city}/formulas/{name}` | Same checks, then atomic write of `<cityRoot>/formulas/<name>.toml` |
| `DELETE /v0/city/{city}/formulas/{name}` | Removes the city-local file only |
| `GET /v0/city/{city}/formulas` | Catalog |
| `GET /v0/city/{city}/formulas/{name}` | Compiled preview at defaults |
| `POST /v0/city/{city}/formulas/{name}/preview` | Compiled preview with vars |

Validate and upsert take the raw TOML as the body (1 MiB cap). The `formula` string inside the file must equal the path name. `feed` is a reserved name.

Writes use the same guards as other city mutations: `X-GC-Request` must be present, and a write-auth-hardened city also requires a single-use `X-GC-City-Write` grant bound to that request. Read-only mode rejects the write. The UI uses those existing headers. It does not invent a second token.

The dashboard SPA shows formula runs (`/runs/:runId`). It does not call source, validate, or upsert. There is no formula text editor in GasCity's dashboard.

### What Dyad already has

On this base (`cursor/preview-wake-34-bbea`) there is no formula page and no client of the formula HTTP API.

`src/` talks to GasCity through the host bridge on port 32100. That bridge is Dyad receiving calls. It is not a client of `/v0/city/.../formulas`.

A visual editor exists only on `cursor/preview-phase-git-readiness-55d6`:

- `src/pages/workflow.tsx` draws a graph.
- `src/lib/workflow/formulaGraph.ts` parses a small TOML subset (`id`, `title`, `description`, `type`, `needs`, `metadata`).
- Files are stored under the **app project** directory: `<project>/formulas/<name>.toml`, plus `.layout.json` and `.run.json`.
- Save runs `gc formula show` in that project directory. That compiles. It does not cook.
- The same page can call `gc bd close` for a gate bead.

That editor is the visual surface this iteration is not starting from. Its files also sit in the wrong directory for GasCity: the city resolver reads `<cityRoot>/formulas/`, not the Dyad app project. `gc formula show` from an app directory only works when that directory is itself a city or rig. Do not extend this graph page for the first three formulas.

### What the preview deploy already does

`Dockerfile.gascity` packages the Dyad app. The runtime image is noVNC plus the Electron shell. It does not install `gc`. The entrypoint starts X, noVNC, and Dyad. It does not start a city or an orchestrator.

`compose.preview.yml` runs one service, `dyad`, from that image. It mounts an empty `pr-<n>-city` volume at `/city`. The file says it does not mount `/opt/gascity/city`. Factory port 32100 stays unpublished. The browser reaches the page through cloudflared at `https://pr-<n>.anakwannaphaschaiyong.com`.

`preview-image.yml` builds or reuses `ghcr.io/<owner>/dyad:sha-<commit>` and then runs `scripts/gascity/preview-up.sh` on the Devbox. `preview-up.sh` refuses to run where `/opt/gascity/weaver-plus` exists, so it cannot be pointed at the production city checkout. `preview-wake.yml` only starts the existing `dyad` and `cloudflared` containers. It does not build, and it does not run `gc`.

`gascity-rollout.yml` is a different workflow. It SSHs to the Gas City EC2 host after CI. That host is the orchestration machine. This plan does not add formula cook or sling to it, and it does not call it from the preview workflow.

## 2. Existing, missing, proposed

### Already implemented

- Formula TOML, v2 compiler, recipe, and bead materialization.
- `gc formula list`, `show`, `cook`, and `gc sling --formula`.
- City-local file storage at `<cityRoot>/formulas/<name>.toml`.
- HTTP read, validate, save, and delete of that file.
- Per-step agent routing via `gc.run_target`.
- Preview image build and deploy of the Dyad container, with no `gc` and no bead execution.
- A separate Gas City host rollout that is not the preview path.

### Partially implemented

- The visual graph editor on `cursor/preview-phase-git-readiness-55d6`. It edits a TOML subset and compiles with `gc formula show`, but it stores files in the app project, it is not on this base, and its gate-close path mutates beads. Leave it alone for this iteration.
- The dashboard can display a running formula. It cannot edit the source.
- The preview city volume exists and is empty. It is not a running GasCity city.

### Missing

- Three phase formula files: `discovery`, `implementation`, `delivery`.
- A page that selects one of those three, shows the text, edits it, validates it, and saves it.
- A Dyad client of GasCity's formula source, validate, and upsert routes.
- A configured supervisor URL and write grant for that client. Dyad does not have one today.
- A check that the saved file is the file `gc formula show` and `gc formula cook` read, performed on the GasCity host rather than in Actions.

### Proposed, and nothing else

1. Add a Formula Configuration page to the Dyad app that `Dockerfile.gascity` already packages.
2. The page has three choices: Discovery, Implementation, Delivery. They map to formula names `discovery`, `implementation`, and `delivery`.
3. The body is a plain-text editor. No graph, no layout file, no run overlay.
4. Validate posts the text to `POST /v0/city/{city}/formulas/{name}/validate`.
5. Save puts the same text to `PUT /v0/city/{city}/formulas/{name}`.
6. Open loads `GET /v0/city/{city}/formulas/{name}/source`.
7. Ship three starter TOML texts in the page for the empty case (GET source 404). They are not written until the user saves. Each starter is a v2 formula: `[requires] formula_compiler = ">=2.0.0"`, a few `[[steps]]`, `needs` where order matters, and `metadata.gc.run_target` on each work step.
8. Keep using `preview-image.yml` and `preview-up.sh` to publish the `dyad` image. Do not add a second container. Do not add `gc`, `cook`, or `sling` to any preview workflow.

## 3. Where files are stored

The durable copy is the city-local file GasCity already uses:

```text
<cityRoot>/formulas/discovery.toml
<cityRoot>/formulas/implementation.toml
<cityRoot>/formulas/delivery.toml
```

The Formula UI does not keep a second store. A successful PUT is the save. The next GET source is the retrieve. GasCity's resolver sees the file on the next `gc formula list` / `show` / `cook` because the upsert refreshes formula layers.

The starter text in the repo is only the editor's empty-state draft. It is not a formula until PUT writes it into the city.

Do not write these files under the Dyad app project. Do not commit live edits back through the preview workflow.

## 4. How the UI talks to GasCity

The page calls the supervisor that is already running for the target city. The preview container does not start that supervisor.

```text
Formula page  --GET source-->     supervisor  --read-->  <city>/formulas/<name>.toml
Formula page  --POST validate-->  supervisor  --compile in memory, no beads-->
Formula page  --PUT text-->       supervisor  --atomic write + refresh layers-->
```

The supervisor base URL and city name are settings of the page, pointed at the GasCity control plane. Writes send `X-GC-Request`. On a hardened city they also send `X-GC-City-Write` using GasCity's existing grant. The preview workflow does not mint that grant and does not store it in the workflow file.

Validate failure is shown as the `errors` list from the validate response. Save is refused when that list is non-empty; the PUT handler enforces the same checks again.

The page never calls:

- `gc formula cook`
- `gc sling`
- `POST /beads`
- `POST /bead/{id}/close`
- order create

## 5. Which container, and how it is deployed

The Formula UI lives in the existing `dyad` service.

| Piece | Role |
| --- | --- |
| `Dockerfile.gascity` | Builds the image that contains the Dyad app, including the new page |
| `compose.preview.yml` service `dyad` | Runs that image |
| `preview-image.yml` | Builds or reuses `ghcr.io/<owner>/dyad@sha256:...` and runs `preview-up.sh` |
| `preview-wake.yml` | Starts the already deployed `dyad` and `cloudflared` containers |
| Public check | `https://pr-<n>.anakwannaphaschaiyong.com` returns the browser bridge page |

`preview-image.yml` on this base only runs on `cursor/preview-bridge-proof-9e7a`. The implementation PR that changes the page has to be allowed to publish an image the same way, still through `preview-up.sh`, still as the `dyad` service. That change is a branch trigger for the UI image. It is not a new job, and it is not permission to run beads.

`preview-wake.yml` stays a start-existing-containers workflow. It must not gain a formula step.

`gascity-rollout.yml` stays the EC2 host rollout. It is not how the Formula UI is deployed, and it is not where Outcome A is checked.

## 6. Outcome A — check the UI without running beads

On the preview URL, in the browser:

1. Open the Formula Configuration page.
2. Select Discovery. The text area shows the starter, or the saved source if PUT already happened.
3. Change a title. Validate. A well-formed v2 file returns `valid: true`.
4. Break the file (remove `formula`, or set `formula` to a different name). Validate returns `valid: false` and the error text. Save stays disabled.
5. Restore the file and save. The response status is `saved`.
6. Reload the page, select Discovery again, and confirm the edited text came back from GET source.
7. Repeat the load, validate, and save for Implementation and Delivery.

Independence checks:

- The preview workflow log contains no `gc formula cook`, `gc sling`, or bead create.
- `preview-up.sh` still refuses a machine that has `/opt/gascity/weaver-plus`.
- The `dyad` container still has no `gc` binary.
- After a save, the GasCity host has the new `.toml` file, and `gc formula list` can see the name. That observation is a file check. It is not a cook.

If the supervisor URL is unset, the page shows that it cannot validate or save. It does not fall back to writing a local file or to cooking.

## 7. Outcome B — GasCity consumes the files and runs the beads

Do this on the GasCity host, in the city whose `formulas/` directory received the PUT. Do not add it to a GitHub Actions workflow. Do not run it inside the preview container.

1. `gc formula list` includes `discovery`, `implementation`, and `delivery`.
2. `gc formula show discovery` prints the compiled steps and ends with `discovery.workflow-finalize`. The same for the other two names. This creates no beads.
3. `gc formula cook discovery` writes the workflow root and the step beads and stops. Confirm the beads exist and that no agent session started.
4. Cook Implementation and Delivery the same way when those files should be instantiated.
5. Execution, only when a run is actually wanted: `gc sling <agent> discovery --formula`. The orchestrator routes the work beads and completes the control beads. Watch that run with the existing dashboard run view or `gc` bead commands.

Cook and sling use the city store the worker reads. Run them from that city (or with the city's `--rig` when the formula is rig-scoped). A cross-store sling is refused by GasCity already.

## 8. Implementation order

1. Add the three starter TOML strings and a pure function that maps Discovery, Implementation, and Delivery to `discovery`, `implementation`, and `delivery`. Test the mapping and that each starter names itself and declares `formula_compiler = ">=2.0.0"`.
2. Add a small client for GET source, POST validate, and PUT upsert. Test it against a fake HTTP server. Assert the client never requests cook, sling, or bead routes.
3. Add the page: phase select, text area, validate, save, reload. Wire it through the existing IPC and TanStack Query pattern. The main process calls the supervisor. The renderer does not hold the write grant.
4. Point the client at the supervisor with settings already used for that city. Document the URL and the write-grant requirement in the plan's follow-up, not in the workflow.
5. Let `preview-image.yml` publish the `dyad` image for the implementation branch, using the current `preview-up.sh` path. Review the workflow diff for any `gc`, `cook`, or `sling` invocation and reject it.
6. Run Outcome A on the preview URL.
7. Run Outcome B on the GasCity host after the three files are saved.

## What this iteration will not do

- No visual formula editor.
- No new bead, convoy, or agent abstraction.
- No order, no sling, and no cook from the page or from Actions.
- No change to `gascity-rollout.yml` as part of deploying the page.
- No copy of the production city into the preview volume.
- No use of the formula `phase` key to mean Discovery, Implementation, or Delivery.
