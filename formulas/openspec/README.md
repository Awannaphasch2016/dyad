# openspec

Gas City formulas for an OpenSpec change. They do not vendor the OpenSpec CLI. Gas City orders the steps. The CLI validates and archives when it is on PATH.

`openspec-build` is the native sequence. `specs` and `design` both wait only on the proposal. `tasks` waits on both. `accept-apply` is the propose-workflow pause: one bead, one mail to `human`, and a verdict check. `approve` starts the task drain. `request-changes` revises the change artifacts. Archive runs after finalize, and publish waits for archive.

`openspec-phased` adds Discovery, Implementation, and Delivery gates. The Discovery gate is that same pause before apply. Implementation is the drain plus review. Delivery is the final report. Archive waits for the delivery verdict.

```sh
gc import add --name gc https://github.com/gastownhall/gascity-packs.git//gascity
gc sling gc.run-operator <bead-id> --on openspec-build \
  --var artifact_root=openspec/changes/<change-name>
```

Use `--on openspec-phased` for the three phase gates. `artifact_root` receives `proposal.md`, `specs/**/spec.md`, `design.md`, and `tasks.md`.
