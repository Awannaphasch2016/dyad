Revise the artifacts for this human gate.

This child is the producing step that runs again when the verdict is `request-changes` and `human_gate.role` equals `gc.human_gate.role`. The check on the parent gate reads both keys from the confirm bead. It does not read the mail body. A reply from any other role is not feedback.

On the first attempt there is no prior feedback. Do not rewrite artifacts. Close this child.

On a later attempt, find the latest bead in this workflow whose `human_gate.loop_step` matches this gate, whose `human_gate.verdict` is `request-changes`, and whose `human_gate.role` equals this gate's `gc.human_gate.role`. Apply `human_gate.feedback` to the artifacts this phase already produced:

- Discovery: the requirements, plan, and task breakdown the phase wrote.
- Implementation: the code, tasks, and review notes the feedback names.
- Delivery: the final report and any release notes the feedback names.
- Apply: the OpenSpec proposal, specs, design, and tasks the feedback names.

Do not start the next phase. Record the files you changed on this bead as `human_gate.revision_notes`.

Do not send mail. The confirm child sends the one human mail for this attempt. Do not choose `approve` yourself.
