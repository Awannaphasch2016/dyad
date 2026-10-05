# Close pull request 34 and the previews stacked with it

Pull request 34 is the draft "Refresh the Clerk session JWT the main process verifies" (`cursor/session-jwt-refresh-bbea` into `cursor/preview-bedrock-render-bbea`). Its public site is https://pr-34.anakwannaphaschaiyong.com. The tip is nine commits on pull request 29: the session JWT refresh, the Doppler OIDC fetch, and the preview workflow entries that keep that site up.

Clicking merge does not land it on `main`. The parents under it have drifted, and the walkthrough fix is on a side branch that does not contain the JWT commits.

## Related pull requests

Already finished:

- **10, merged.** `cursor/ipad-gate-close-bbea` into `main`. Close the Gas City gate from a saved iPad answer.
- **32, merged.** Stale Bedrock bearer removal. Those commits are on pull request 29.

The chain under 34, from `main` upward. A "clean" child contains its parent's tip.

| PR | Into | Clean on parent | What it is |
| --- | --- | --- | --- |
| 11 | `cursor/ipad-gate-close-bbea` | yes, and the tip `fed245c8` is already in `main` | Browser bridge for the Dyad UI |
| 20 | `cursor/browser-dyad-ui-bbea` | no | Preview images, Neon branch, Devbox. Has the `preview` label. Live site for pull request 20 |
| 27 | `cursor/preview-bridge-proof-9e7a` | no | Formula graph on a Wewebplus preview |
| 29 | `cursor/formula-preview-9e7a` | no | Bedrock IAM on that preview. Parent of 34 |
| 34 | `cursor/preview-bedrock-render-bbea` | yes, 9 commits | Session JWT refresh and the Doppler OIDC fetch |

On top of 34:

| PR | Clean on 34 | What it is |
| --- | --- | --- |
| 33 | no. One plan commit, sibling of 34, same parent as 34 | Plan: workflows use Doppler OIDC. 34 already has the fetch commits (`83ef33a5` through `79340cb1`) |
| 36 | yes, 2 commits | Resume preview 34 from the published image, including the Cloudflare credential fetch |
| 38 | yes, 3 commits. Has the `preview` label | Plan and workflow: one `preview` label builds or reuses the image |

The walkthrough side branch. It does not contain 34.

| PR | Clean on its parent | What it is |
| --- | --- | --- |
| 21, closed | no, diverged from 20 | Wake the preview tunnel after the Devbox stops |
| 37 | yes, 1 commit on 21 | Wake the existing preview 34 containers |
| 39 | yes, 7 commits on 37 | The three walkthrough fixes. The code commit is `a254986c`. The six commits before it are plan revisions |

Nearby, not in this chain:

- **35.** One docs commit on 11. 11 is already in `main`. 34 also edits `docs/gascity-docker.md`.
- **26.** Two commits on current `main` (`cursor/land-preview-main-9e7a` is `main`). Gas City hostname. It does not block 34.

Only 20 and 38 have the `preview` label. 34 stays up because `preview-image.yml` lists `cursor/session-jwt-refresh-bbea` by hand, with `cursor/preview-bridge-proof-9e7a`, `cursor/formula-preview-9e7a`, and `cursor/preview-bedrock-render-bbea`.

## Close order

1. **Close 11.** Its tip is already in `main`. Do not merge it again.
2. **Close 33.** 34 already fetches `dyad`/`preview` and `aws`/`dev` with Doppler OIDC. Keep the plan file only if a sentence in it is still missing from 34; do not merge the plan branch.
3. **Close 35** when the Doppler sentence in 34's `docs/gascity-docker.md` matches it. If a line is still missing, cherry-pick `36a63e0b` onto `main`.
4. **Rebase the drifted parents, from the bottom.** 20 onto `main`, then 27 onto 20, then 29 onto 27. 34 is a clean nine-commit tip on 29, so it rebases with 29. Resolve each drift before the next. Do not merge 34 into 29 until 29 contains the rebased 27.
5. **Fold 36 into 34** after that rebase. The two commits are the resume path for this preview. 36 then closes as merged.
6. **Cherry-pick `a254986c` from 39 onto 34.** Leave `d33c08a1` through `bd869c9b` behind; they are plan revisions. 39 does not contain the JWT branch, so do not merge 39 into 34.
7. **Walk the preview again** on https://pr-34.anakwannaphaschaiyong.com after that cherry-pick is deployed. Discovery restore of a user message, Implementation `write_file` on an app that has `package.json`, and opening the chat list must not show the three walkthrough failures. The blueprint gate stays.
8. **Leave 38 until 34 is on `main`.** The label redesign is not required for the JWT fix. After 34 merges, either rebase 38 onto `main` or close it if the same change deletes the handwritten four-branch list.
9. **Merge upward, then turn preview 34 off.** Merge 20, 27, 29, then 34 into `main`. Remove `cursor/session-jwt-refresh-bbea` from the list in `preview-image.yml` and from the exemption in `preview.yml`. Destroy tunnel `preview-pr-34`. Close 37; it only wakes that preview. Close 39 as superseded by the cherry-pick.
10. **Leave 26 on its own.** It targets `main` and is not part of this stack.

## Out of scope

- Rewriting the session JWT design.
- Merging the formula graph, the Bedrock IAM change, or the preview publisher for their own product reasons. They move only because 34 cannot reach `main` while it sits on drifted parents.
- The open pull requests that do not touch this stack (9, 12, 13, 14, 15, 16, 19, 28, 30, 31).
