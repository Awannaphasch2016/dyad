# Gas City methodology formulas

Column 2 is Gas City orchestration: each methodology keeps its own artifacts and order, and Gas City runs the steps, drains, and fan-outs. Column 3 adds Discovery, Implementation, and Delivery human gates on that graph.

A blocking gate is one open confirmation bead, one `gc mail send human`, and `human-gate-verdict.sh`. `approve` continues only when the reply's `human_gate.role` equals that gate's `gc.human_gate.role`. Discovery and Delivery require `project-manager`. Implementation requires `developer`. `request-changes` from that same role runs the gate's revision child again. Dyad writes both keys from the signed-in membership. A reply from any other role does not accept the gate.

| Methodology | Column 2 | Column 3 |
| --- | --- | --- |
| OpenSpec | `openspec-build` in this repo | `openspec-phased` |
| Spec Kit | `speckit-build` in this repo | `speckit-phased` |
| BMAD | upstream `bmad-build` | `bmad-phased` |
| Superpowers | upstream `superpowers-build` | `superpowers-phased` |
| gstack | upstream `gstack-build` | `gstack-phased` |
| Compound Engineering | upstream `compound-build` | `compound-phased` |
| Gas City starter | upstream `build-basic` | `build-basic-phased` |

Upstream `gastownhall/gascity-packs` was checked at the same time as the fork `Awannaphasch2016/gascity-packs`. Both have those five build methodologies. Upstream also has `contributing-to-gascity` (the fork still calls it `contributing`) and release-gate notes. Those are not build methodologies, so they are not rows here. Slack, GitHub, Discord, and pull-request packs are integrations, not rows.

`gsd/` is a separate sketch and is not part of this matrix.

Place a pack directory next to the `gascity` pack. Column 3 formulas also need the upstream methodology pack installed so `extends` can resolve `bmad-build`, `superpowers-build`, `gstack-build`, `compound-build`, or `build-basic`.

```sh
gc import add --name gc https://github.com/gastownhall/gascity-packs.git//gascity
gc import add https://github.com/gastownhall/gascity-packs.git//bmad
gc sling gc.run-operator <bead-id> --on bmad-phased \
  --var artifact_root=plans/<change>/build
```

`openspec-build` and `speckit-build` extend `build-base` from the gascity pack. `speckit-build` does not run `specify workflow`.
