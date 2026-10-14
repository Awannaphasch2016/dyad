# Configurable methodology pack

This plan does not change code. It records what has to change so a Vibe SDK run follows one methodology pack chosen by configuration.

The Think agent, the prompt box, and the Orange question stay the execution and the screen. The pack is data. [plans/vibesdk-spec-driven-ui.md](vibesdk-spec-driven-ui.md) would paste the Spec Kit order into the builder prompt. This plan does not do that.

## What exists today

Vibe SDK does not read a methodology. `ThinkAgent` writes files, asks one question, and deploys the preview. `buildSystemPrompt` in `worker/agents/core/behaviors/think.ts` tells that agent when to ask and when to call `deploy_space`. There is no pack field on the app.

The packs are Gas City formulas under `formulas/` on [PR #148](https://github.com/Awannaphasch2016/dyad/pull/148) and [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). Gas City already selects one with the formula name:

```sh
gc sling gc.run-operator <bead-id> --on speckit-phased --var artifact_root=specs/<feature>
```

`src/lib/methodologyPacks.test.ts` checks the graphs. Nothing in the Vibe SDK worker imports it. Dyad’s formula client only knows the three names `discovery`, `implementation`, and `delivery`. That list is not the pack switch.

| Formula id | Pack in this repo | Resolves from this repo |
| --- | --- | --- |
| `speckit-build`, `speckit-phased` | `formulas/speckit` | Yes. Extends `build-base`, which is imported from the gascity pack. |
| `openspec-build`, `openspec-phased` | `formulas/openspec` | Yes. Same base. |
| `gsd-build` | `formulas/gsd` | Yes. The GSD sketch is outside the column-3 matrix and uses its own artifacts. |
| `bmad-phased` | `formulas/bmad-hitl` | No. Extends upstream `bmad-build`, which is not vendored here. |
| `superpowers-phased` | `formulas/superpowers-hitl` | No. Extends upstream `superpowers-build`. |
| `gstack-phased` | `formulas/gstack-hitl` | No. Extends upstream `gstack-build`. |
| `compound-phased` | `formulas/compound-hitl` | No. Extends upstream `compound-build`. |
| `build-basic-phased` | `formulas/build-basic-hitl` | No. Extends upstream `build-basic`. |

Changing the Vibe SDK prompt for each of those rows would be a separate implementation. The configuration below is one path for all of them.

## The configuration

One value, the formula id. The preview reads it from `VIBESDK_METHODOLOGY`. The default is `speckit-phased`.

On create, that value is copied onto the Vibe SDK D1 app row as `methodology`. Later edits to the environment do not retarget an app that has already started. The home prompt is still the product request. It is not where the pack is typed.

An id that is not in the catalog is refused at create. An id whose formula `extends` a pack that is not on the formula path is refused the same way. The run does not fall through to Spec Kit.

## What changes

### Catalog

Add a catalog next to the formulas, one record per formula id in the table above. Each record has the pack directory, the formula file, the `extends` list, and `runnable`. `runnable` is true only when every extended formula is either in this repo or already imported beside it.

`src/lib/methodologyPacks.test.ts` gains one check: every catalog id points at a formula file, and `runnable` is false exactly when `extends` names a formula this repo does not contain. Adding a pack is a catalog row plus its formula files. It is not a change to `ThinkAgent`.

### App row

The preview’s Vibe SDK D1 `apps` table gains `methodology`. The create path writes `VIBESDK_METHODOLOGY` there after the catalog accepts it. Shared `wewebplus` is not altered.

### Runner

New host code reads `apps.methodology` and loads that formula. It does not branch on the id inside the Think prompt.

For each step, the host does one of three things it already knows how to do:

- A step that writes artifacts calls the existing Think agent with that step’s description and the artifact paths from the formula. The agent does not receive a second, Spec-Kit-specific prompt.
- A step that waits for a person opens one organization question through the existing `ask_questions` path. The question text is the one the formula produced. The named role answers in the prompt box. The answer is the verdict or the clarification the formula is waiting on.
- An implement drain calls the existing file tools and `deploy_space`. `deploy_space` stays refused on every earlier step.

`generate_all` still wakes the agent. The runner decides which step that wake-up is.

When Gas City can resolve the formula, Gas City owns the graph and this host only adapts mail and `human_gate.verdict` onto the organization question. When Gas City cannot resolve it, the host walks the same formula file. Both paths read the same catalog id. Neither path embeds Superpowers, BMAD, gstack, or GSD instructions in `think.ts`.

### Question role

The formulas mail `human` and do not name an organization role. The host applies the rule the screen already uses. A requirements or product question goes to the Project Manager. A technical question goes to the Developer. A missing role goes to the Project Manager and is marked fallback. GSD’s `gc.hitl.role` metadata is read when the step has it: developer acceptance stays the Developer, and the ship gate stays the Project Manager. The screen still does not draw Discovery, Implementation, or Delivery.

### File gate

The allowlist is the artifact paths of the current step. Spec Kit’s `spec.md`, `plan.md`, and `tasks.md` are that allowlist only while the running formula is Spec Kit. GSD’s `.planning` files are the allowlist only while the formula is `gsd-build`. A step that is not the implement drain cannot call `deploy_space`.

## What stays

- Only the Project Manager’s Enter on the home prompt creates an app.
- Both roles open the organization’s app. The organization owns it.
- One Orange question, one answer, and “Response required” for the other role.
- The account name, the three avatars, the apps heading, and the clear when the open app changes.
- `assertProjectManager`, `shouldBeGenerating`, and the preview socket.
- Electron, hitl-web, Bolt, and the shared `wewebplus` columns.
- The Gas City formula files. This plan does not rewrite their step order.

## Change impact matrix

Same columns and same rule as [vibesdk-session-scope.md](vibesdk-session-scope.md). A row is finished only when every **Change** cell is true and every **Leave** cell still behaves as the last live run left it.

| Intention | Membership | Sign-in | App record | Question record | Agent run | Permissions | Controls | Chrome | Delivery | Other products |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The pack is a configuration value | Leave. | Leave. | Change. Store `methodology` at create from `VIBESDK_METHODOLOGY`. | Leave. | Leave. The Think loop does not gain a per-pack prompt. | Leave. | Leave. The home prompt stays the product request. | Leave. No pack picker and no phase strip. | Leave. | Leave. |
| An unknown or unresolved pack does not start | Leave. | Leave. | Change. Create refuses an id the catalog marks unresolved. | Leave. | Leave. | Leave. `assertProjectManager` still refuses a Developer create. | Leave. | Leave. | Leave. | Leave. Do not vendor upstream packs inside the Vibe SDK worker. |
| The same agent runs whichever pack resolved | Leave. | Leave. | Leave. The stored id is what the runner loads. | Change. A waiting step is still one question row. The body is the formula’s question. | Change. The runner supplies the current step description and artifact paths. `buildSystemPrompt` does not contain Spec Kit, Superpowers, BMAD, gstack, or GSD text. | Leave. Role routing stays the host rule above. | Leave. The answer is still chat Enter. | Leave. Both roles see the step’s artifacts. Only the named role sees the question body. | Leave. `deploy_space` runs on the implement step only. | Leave. Gas City keeps the graphs. The host adapts mail onto the existing question. |

## Important points

1. The configuration value is the formula id. `VIBESDK_METHODOLOGY` defaults to `speckit-phased` and is stored on the app at create.
2. Spec Kit, OpenSpec, and GSD resolve from formulas already in this repo. Superpowers, BMAD, gstack, Compound Engineering, and `build-basic` resolve only after their upstream pack is imported. Until then the catalog marks them unresolved and create refuses them.
3. The Think agent, `deploy_space`, and the Orange question stay one implementation. They receive the current step. They do not contain a methodology.
4. The new pieces are the catalog, the `methodology` column on the Vibe SDK app, and the runner that maps a formula step onto a Think turn or an organization question.
5. Artifact filenames and the moment `deploy_space` is allowed come from the running formula. They are not hardcoded to `spec.md`, `plan.md`, and `tasks.md`.
6. The home prompt, who may press Enter, the role question, and shared `wewebplus` stay as they are. There is no pack picker and no phase strip.
7. [plans/vibesdk-spec-driven-ui.md](vibesdk-spec-driven-ui.md) is the Spec Kit behavior of this same screen. Its hardcoded prompt is not the way the pack is selected.

## How to verify

| Check | What passes |
| --- | --- |
| Default | With `VIBESDK_METHODOLOGY` unset, the created app stores `speckit-phased`. The first artifacts are that formula’s spec, plan, and tasks. |
| Switch | Set the value to `gsd-build`. A new app stores `gsd-build`. The files follow that formula’s `.planning` paths. The Think source has no GSD prompt of its own. |
| Refused | Set the value to `superpowers-phased` before the upstream pack is imported. Create is refused. No app row is written. |
| Same screen | For a resolved pack, the Project Manager still starts from the home prompt. A waiting step is one Orange question. The other role sees “Response required” and not the body. The preview appears on the implement step. |
| Unchanged agent | The unit test shows `buildSystemPrompt` contains the current step text it was given and does not contain a Spec Kit, Superpowers, BMAD, gstack, or GSD procedure. |
