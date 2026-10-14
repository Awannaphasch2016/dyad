# Gas City methodology formulas

`openspec/`, `speckit/`, and `gsd/` are Gas City packs. Each one extends `build-base` and imports `../gascity` when these directories sit next to the `gascity` pack in a packs repository.

They were added here because this agent cannot push to `Awannaphasch2016/gascity-packs`. They are not a registry release, and they are not in the packs compatibility suite.

Suspend and gate steps are scheduled on `gc.run-operator`. `gc.hitl.role` names the organization role a host should check. The formula runtime does not check it.
