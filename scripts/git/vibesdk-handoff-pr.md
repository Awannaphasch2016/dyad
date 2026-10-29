This pull request brings the kept Vibe SDK host from Dyad onto this fork. A person opens a project only when they are assigned to it, and the question is one line in the chat. The demo uses the pin's default Think behavior. Docker is not included.

The behavior was proven on [Dyad #184](https://github.com/Awannaphasch2016/dyad/pull/184). `docs/dyad-handoff.md` is that handoff note. This commit is the same patches, applied as source on `9da158d`.

## Decisions

- The existing prompt box is the only typing place. A reply is the next user message and starts the next run.
- Only the Project Manager can create. Create records `org_id` and `created_by`, inserts that person into `org_members` as `admin`, and assigns them to the project as `project-manager`.
- Permissions are fixed in code. `project-manager` can view, start, and delete. `developer` can view. An admin sees only assigned projects and assigns people with `POST /api/org/assign`.
- Delete belongs to every assigned project manager. Gallery changes stay refused.
- The named role sees the question in the chat. The other role sees the waiting line and not the body.
- Roles for the organization roster are read from `wewebplus.memberships`. Those shared tables are not altered here.
- The question intercept is a patch on `ThinkCodingBehavior`. `ThinkAgent` still owns the model and tool loop.

## Where the Dyad work came from

Parent to child: [#68](https://github.com/Awannaphasch2016/dyad/pull/68) → [#124](https://github.com/Awannaphasch2016/dyad/pull/124) → [#128](https://github.com/Awannaphasch2016/dyad/pull/128) → [#135](https://github.com/Awannaphasch2016/dyad/pull/135) → [#138](https://github.com/Awannaphasch2016/dyad/pull/138) → [#143](https://github.com/Awannaphasch2016/dyad/pull/143) → [#153](https://github.com/Awannaphasch2016/dyad/pull/153) → [#158](https://github.com/Awannaphasch2016/dyad/pull/158) → [#161](https://github.com/Awannaphasch2016/dyad/pull/161) → [#164](https://github.com/Awannaphasch2016/dyad/pull/164) → [#165](https://github.com/Awannaphasch2016/dyad/pull/165) → [#166](https://github.com/Awannaphasch2016/dyad/pull/166) → [#167](https://github.com/Awannaphasch2016/dyad/pull/167) → [#168](https://github.com/Awannaphasch2016/dyad/pull/168) → [#170](https://github.com/Awannaphasch2016/dyad/pull/170). This change starts from #135 and does not carry the later commits.

- #68 and #86: the preview worker and the shared Clerk session. The kept session key is `vibesdk-shared-role`.
- #121 and #127 plan the agent-driven loop. #124's scripted card is left out. #128 is the real prompt box and is kept.
- #129 and #134 plan organization belonging. #135 stops treating the creator as the owner. This commit keeps that and limits opening to project assignment, which was decided on #184.
- #137 and #138 are the two-view question rule. The lock icon and account-name labels are left out. #139 and #143, the avatars and the Orange card, are left out.
- #147 and #153 owe `generate_all`. Left out. The pin already sends it after the handshake.
- #157 and #158 are session chrome. Left out.
- #161 through #170 are the methodology catalog, phase packs, Spec Kit, and the one-shop recording. Left out.
- Merged Dyad #7, #8, #9, and #12 are the Wewebplus membership tables this host reads. They are not Vibe SDK source.

Docker, the two-browser GitHub job, and the Dyad preview workflow stay in Dyad.
