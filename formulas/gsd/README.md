# gsd

Gas City formula for the GSD phase loop from [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done): discuss, plan, execute in waves, verify, ship. It extends `build-base`. It does not vendor the GSD command files.

```sh
gc import add https://github.com/Awannaphasch2016/gascity-packs.git//gsd
gc sling gc.run-operator <bead-id> --on gsd-build \
  --var artifact_root=.planning
```

`artifact_root` is the `.planning` directory. The formula writes `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, a phase `CONTEXT.md`, `RESEARCH.md`, one `PLAN.md` per wave, `VERIFICATION.md`, and `UAT.md`.

Research is a fan-out of four agents (stack, features, architecture, pitfalls), then a synthesizer. Execution drains independent plans in a wave, and the next wave waits. GSD's `--auto` flag skips questions; these suspend and gate steps do not.

The formula schedules suspend and gate steps on `gc.run-operator`. Gas City does not check an organization role. `gc.hitl.role` is metadata for the host that does.
