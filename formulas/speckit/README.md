# speckit

Gas City formula for the Spec Kit command sequence. It extends `build-base`. It does not vendor the Spec Kit CLI or run `specify workflow`.

```sh
gc import add https://github.com/Awannaphasch2016/gascity-packs.git//speckit
gc sling gc.run-operator <bead-id> --on speckit-build \
  --var artifact_root=specs/<feature>
```

The folder receives `spec.md`, `plan.md`, and `tasks.md`.

`review-spec` sits between clarify and plan, matching Spec Kit's first gate. `plan-review` matches the second. Reject continues the previous producing step with the feedback. Spec Kit's own engine aborts by default; this formula does not, because a tenant rejection has to stay on the same stage.

Suspend and gate steps are scheduled on `gc.run-operator`. Gas City does not check an organization role. `gc.hitl.role` is metadata for the host that does.
