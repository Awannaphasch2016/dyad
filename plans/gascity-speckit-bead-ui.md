# Show each Spec-Kit bead in the three phase chats

Status: not started. The recording on [PR #173](https://github.com/Awannaphasch2016/dyad/pull/173) posted six sentences a local script had typed in advance. The phase bar then looked up those step ids in Dyad's own table and printed Specify, Plan, Tasks. Spec-Kit did not run, so the chat had no `spec.md`, no question, and no page.

## Important points

1. Walk the three chats. One Discovery send is one `gc sling` of `speckit-phased`. The beads do the work.
2. The paragraph in the chat is the file that bead wrote. The bar title is only the heading.
3. Specify shows `spec.md`. Plan shows `plan.md`. Tasks shows `tasks.md`. Those files live in the app the window has open.
4. Clarify shows a question only when `spec.md` still contains `NEEDS CLARIFICATION`. No marker means no question, and the chat grows no extra paragraph.
5. **Approve and continue** writes the verdict and adds no text. The next phase changes when the next bead posts its own file.
6. Implement writes the app through the tool route. The preview shows those pages. The Implementation chat shows that bead's report.
7. Delivery shows the final report, then Publish. All three phases finish only after publish closes.
8. The proof is the chat beside the file and `gc session logs` for that bead. If `gc formula show speckit-phased` cannot list the beads, stop. A script that authors the sentences is not a run.

## What the window shows

The packs are `speckit-phased` from [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154). `speckit-build` is the command order. `build-base` comes from `gastownhall/gascity-packs`. Dyad already paints a `text` event onto that step's phase chat ([PR #172](https://github.com/Awannaphasch2016/dyad/pull/172)) and **Approve and continue** already posts `{ type: "verdict", verdict: "approve" }`.

| Bead                                    | What the bead writes                                                                       | What the chat shows                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `requirements`                          | `artifact_root/spec.md`                                                                    | That file, on Discovery                                                         |
| `clarify`                               | Answers written back into `spec.md`, and only while a `NEEDS CLARIFICATION` marker remains | The question the bead mailed. The marker is gone from the file after the answer |
| `plan`                                  | `artifact_root/plan.md`                                                                    | That file, on Discovery                                                         |
| `plan-review`                           | The recorded plan                                                                          | That record, on Discovery                                                       |
| `decompose`                             | `artifact_root/tasks.md`                                                                   | That file, on Discovery                                                         |
| `accept-discovery`                      | The gate question: approve these discovery artifacts and start implementation              | Discovery stays put. Implementation has no new paragraph                        |
| `implement` or `implement-same-session` | The app files, through the tool route                                                      | The bead's report on Implementation. The preview is those pages                 |
| `review`                                | The converge report                                                                        | That report, on Implementation                                                  |
| `accept-implementation`                 | The gate question: approve this implementation and its review                              | Delivery has no new paragraph                                                   |
| `finalize`                              | The final report                                                                           | That report, on Delivery                                                        |
| `accept-delivery`                       | The gate question: approve delivery and allow publish                                      | Publish has not started                                                         |
| `publish`                               | The publish result                                                                         | That result, on Delivery. The three phases close when this bead closes          |

`artifact_root` is a directory inside the linked app. The preview and the files are the same project.

## Order

1. **Resolve the formula.** `gc formula show speckit-phased` lists the beads in the table, including `requirements`, `clarify`, `plan`, `decompose`, the three gates, `implement`, `review`, `finalize`, and `publish`. The formula path includes PR #154 and the upstream `build-base` import. A missing bead ends the plan here.
2. **Hand the sling to `gc`.** The POST Dyad already sends (`type: sling`, `formula: speckit-phased`, the prompt, `appId`, `taskId`) starts `gc sling` on the linked app's directory. The work item is the prompt typed in Discovery. The receiver copies the open bead's session text and the artifact it closed. It does not write a stand-in sentence.
3. **Post that bead.** Each event carries `stepId` and `type: text` whose `content` is the artifact. File edits use the existing tool route and wait. A clarify question uses the existing question route. A gate posts `input-required` and waits. `type: end` follows the closed publish bead.
4. **Walk the window.** Record Discovery, Implementation, and Delivery. For each row in the table, the paragraph on screen matches the file, and `gc session logs` names that bead.

## Evidence

The walk counts when all of these are true together:

- Discovery's Specify paragraph is the body of `spec.md`, and the session log names `requirements`.
- A question is on screen only when `spec.md` contained `NEEDS CLARIFICATION`, and that marker is gone after the answer.
- Plan and Tasks on Discovery are `plan.md` and `tasks.md`.
- Approve adds no paragraph. Implementation's first paragraph arrives with the implement bead.
- The preview is the pages that bead wrote, not the blank template.
- Delivery's report is the final-report artifact. Publish's paragraph is the publish result, and the run completes after that bead.

## Out of scope

- A listener that types "Specify:" or any other sentence the bead did not write.
- Treating the bar title as the bead. The title may stay the heading from Dyad's step table.
- Editing formula TOML, or starting the ungated `speckit-build` cell from [PR #156](https://github.com/Awannaphasch2016/dyad/pull/156).
- The AC-01 through AC-20 score in [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159). That scores a different worktree. This plan is the Dyad window.
- Retrying **Doppler organize** after the HTTP 403. `GAS_CITY_ORCHESTRATOR_URL` stays out of the manifest until a source already has the value.
- A new message list. The paint from PR #172 is the renderer.
- Retiring `handleLocalAgentStream` for Ask, Build, Agent, and Plan.
