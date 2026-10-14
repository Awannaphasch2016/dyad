Implement the approved story decomposition using drain policy {{drain_policy}},
implementation target {{implementation_target}}, artifact root, and summary
path supplied by the workflow. Work only on the assigned story beads or convoy
members routed to this stage.

Use the assigned BMAD story implementation skill for each implementation task.
When upstream BMAD text asks for sub-agent/task handoff, represent that
delegation as Gas City beads, convoys, or graph lanes rather than
provider-native execution. Record the implementation summary path and outcome
on the workflow root bead.

Do not invoke provider-native subagents or upstream BMAD runtime commands.
