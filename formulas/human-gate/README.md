# human-gate

Shared HumanGate assets for the methodology packs in this directory.

A blocking gate is one open confirmation bead, one `gc mail send human`, and `human-gate-verdict.sh`. The script reads `human_gate.verdict` and `human_gate.role` on that bead. `approve` closes the gate only when `human_gate.role` equals the gate's `gc.human_gate.role` (`project-manager` or `developer`). Any other reply fails the check. `request-changes` from that same role fails the check, and the gate's revision child runs again.

`gc session wait --sleep --on-beads` only parks the session that is waiting. Dyad writes the same verdict through its own answer path and does not use `--notify`.

The packs copy these assets next to their formulas so a graph.v2 check path of `../assets/scripts/checks/human-gate-verdict.sh` resolves inside the pack that declares it.
