# Drive a formula run on the three-phase window

Status: recorded. One Discovery send slung `speckit-phased`. The window moved Discovery, then Implementation, then Delivery as each bead arrived. Approve posts `verdict: approve`. `gc` did not run. The city for this recording was a local listener. [PR #172](https://github.com/Awannaphasch2016/dyad/pull/172) paints a bead when an event arrives.

## Important points

1. The window is the three phase chats. The step title sits on that bar. New text is the bead that is open.
2. One prompt on Discovery slings `speckit-phased` once. Approve posts `verdict: approve`. The window stays on that phase until the next bead's event arrives. Delivery is finished only after `publish` and `type: end`.
3. `gc` is not installed here, and the preview image does not run `gc`. This run's city is a local listener at `GAS_CITY_ORCHESTRATOR_URL`. It accepts that sling and posts host-bridge events. It does not compile the formula pack.
4. **Doppler organize** cannot be started from this agent (HTTP 403). The workflow on `cursor/axi-toolbox-image-plan-531e` is unchanged. `GAS_CITY_ORCHESTRATOR_URL` stays out of the manifest until a source already has the value.
5. The GitHub Action this push starts is the check on this branch. That is the run to watch.
6. `/formulas/discovery` is a different screen. It is not this recording.

## What the recording shows

| Moment                                   | Phase chat     | What is on screen                                                        |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `requirements` through `decompose`       | Discovery      | That bead's text. The bar title changes with the bead.                   |
| `accept-discovery`                       | Discovery      | Streaming stops. **Approve and continue** is enabled.                    |
| The click                                | Discovery      | The window stays on Discovery. The listener receives `verdict: approve`. |
| `implement`                              | Implementation | The window moves here and shows that bead's text.                        |
| `accept-implementation`                  | Implementation | Delivery stays locked until the next bead.                               |
| `finalize`, `accept-delivery`, `publish` | Delivery       | Delivery is finished only after `publish` and `type: end`.               |

## Order

1. Start Dyad with the host bridge on `127.0.0.1:32100` and `GAS_CITY_ORCHESTRATOR_URL` pointed at the local listener.
2. Create one app so the three phase chats exist, and link it before the send.
3. Send one prompt on Discovery. The listener must see `{ "type": "sling", "formula": "speckit-phased" }`.
4. Post the beads in the table. Each click approves the open gate and does not by itself open the next phase.
5. Save the recording of that window.

## Out of scope

- Claiming `gc` executed `speckit-phased`.
- Dispatching **Doppler organize** again after the 403.
- Adding `GAS_CITY_ORCHESTRATOR_URL` to `preview-up.sh` or `write_rollout_env.py` before a source has the value.
- A button inside Dyad that plays the beads.
- Treating `/formulas/discovery` as the proof window.
