# openspec

Gas City formula for an OpenSpec-shaped change. It extends `build-base`. It does not vendor the OpenSpec CLI.

Launch with the same variables as the other build packs:

```sh
gc import add https://github.com/Awannaphasch2016/gascity-packs.git//openspec
gc sling gc.run-operator <bead-id> --on openspec-build \
  --var artifact_root=openspec/changes/<change-name>
```

`artifact_root` is the change folder. The formula writes `proposal.md`, `specs/**/spec.md`, `design.md`, and `tasks.md` there.

Suspend and gate steps are graph nodes scheduled on `gc.run-operator`. The formula tells that operator to stop and wait for a person. Gas City does not check an organization role, and `gc.hitl.role` is metadata for the host that does. Headless mode does not skip those steps.
