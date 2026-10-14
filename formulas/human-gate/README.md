# human-gate

Shared HumanGate assets for the methodology packs in this directory.

A blocking gate is one open confirmation bead, one `gc mail send human`, and `human-gate-verdict.sh`. The script reads `human_gate.verdict` on that bead. `approve` closes the gate. `request-changes` fails the check, and the gate's revision child runs again.

`gc session wait --sleep --on-beads` only parks the session that is waiting. Dyad writes the same verdict through its own answer path and does not use `--notify`.

The packs copy these assets next to their formulas so a graph.v2 check path of `../assets/scripts/checks/human-gate-verdict.sh` resolves inside the pack that declares it.
