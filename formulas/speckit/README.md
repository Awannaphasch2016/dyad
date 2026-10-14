# speckit

Gas City formulas for the Spec Kit command sequence. They do not vendor the Spec Kit CLI and they do not run `specify workflow`.

`speckit-build` runs specify, clarify, plan, tasks, implement, and converge. Clarify sends at most five questions, and only when `spec.md` still contains `NEEDS CLARIFICATION`. Plan and tasks do not stop for a person.

`speckit-phased` keeps that sequence and adds three human gates. Discovery closes after tasks and before the implement drain. Implementation closes after converge and before the final report. Delivery closes after the final report and before publish. Clarify stays inside Discovery.

```sh
gc import add --name gc https://github.com/gastownhall/gascity-packs.git//gascity
gc sling gc.run-operator <bead-id> --on speckit-build \
  --var artifact_root=specs/<feature>
```

Use `--on speckit-phased` for the three phase gates. The folder receives `spec.md`, `plan.md`, and `tasks.md`.
