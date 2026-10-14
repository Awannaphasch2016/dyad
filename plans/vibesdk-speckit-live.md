# Spec Kit live, as the first selected pack

This run selects one Gas City methodology pack and records the Vibe SDK screen that walks it. The pack is `speckit-phased`. Later packs use the same screen and a different configuration value.

## What is selected

The Gas City formula id is the pack. [PR #154](https://github.com/Awannaphasch2016/dyad/pull/154) is the set of phase packs. Spec Kit is the first one this screen runs.

The preview deploy sets `VIBESDK_METHODOLOGY` to `speckit-phased`. Create copies that value onto the Vibe SDK app. The home prompt stays the product request. There is no pack picker.

The host walks the Spec Kit steps already stored for that id. It does not sling Gas City, and it does not start the GIT Conference run in [PR #159](https://github.com/Awannaphasch2016/dyad/pull/159).

The first step writes `spec.md` and does not deploy. `ask_questions` is refused until that file is written. Writing it moves the host to the next step, and the tool result tells the agent to follow that step before the turn ends. A clarification is one Orange question. The named role answers in the existing prompt box.

## The recording

The walk is the two-role check from [PR #158](https://github.com/Awannaphasch2016/dyad/pull/158). The Project Manager starts the organization app. The Developer’s Enter does not. Both see Wewebplus after the app exists. The question that appears is read and answered. The other role sees “Response required” and not the body. A second app does not show the first question.

This run adds one Spec Kit signal to that walk. After the app is open, the recording waits until `spec.md` is on the screen and screenshots it. The check does not memorize the question. The screen does not draw Discovery, Implementation, or Delivery.

The preview workflow runs that check only for this branch. Playwright records both browsers. The videos are re-encoded to H.264 before the links are handed over.

## Important points

1. The selected pack is the formula id `speckit-phased`, set on the preview as `VIBESDK_METHODOLOGY`.
2. Spec Kit’s first artifact is `spec.md`. The walk screenshots that file. It does not deploy on that step.
3. The recording is the existing two-role organization walk. The question text is whatever the agent asks.
4. Gas City keeps the formula. This run does not sling it and does not start the GIT Conference repository.
5. The prompt box, who may press Enter, the Orange question, and the account-name turns stay as the last live walk left them.
