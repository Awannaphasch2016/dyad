# Shared builder session

> The approval sequence already works. This plan puts that sequence inside the existing Bolt builder instead of a second panel.

## Summary

One Wewebplus project is open in both browsers. The Project Manager starts it from the existing prompt. Both people watch the same chat column, the same phase bar, and the same preview after the build is replayed. A question or approval opens a card on that screen. Only the matching role can act. The other person sees a waiting card. Postgres remains the authority. The page polls it. A Durable Object is not part of this check.

The separate panel, `SharedProject`, is removed.

## Problem

The walkthrough at `https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev` already does this:

- The Project Manager moves Discovery to Implementation.
- The Developer answers the Implementation question and moves to Delivery.
- The Project Manager approves Delivery.
- Both sessions then show Download and receive the same stored file.

That sequence lives in `app/components/factory/SharedProject.tsx`, which the deploy patch inserts into the phase bar. The prompt there is not `ChatBox`. The transcript there is not `Messages`. The model call there does not go through `POST /api/chat`, so the workbench never receives the turn. The large prompt is set read-only, and the phase-strip buttons are disabled.

The two people are collaborating on one builder session. They are not using a side console.

## Scope

### In scope

- One shared Bolt project for the two Wewebplus roles.
- The existing prompt, transcript, phase bar, and modal.
- Role checks on send, answer, and transition, in the UI and on the server.
- The real builder turn (`useChat` → `POST /api/chat`) stored on the shared project.
- The other browser loads new messages into the existing chat and applies file actions once.
- The same Download after Delivery approval.
- Polling every two seconds.

### Out of scope

- A Durable Object, WebSocket fan-out, or token-by-token streaming into the second browser.
- Forma, Vibe SDK, and DYAD’s `src/components/chat/FactoryPhaseBar.tsx`.
- Filling `bolt` / `prd`. Production Clerk. A model picker.
- One shared WebContainer process. Each browser still runs its own preview from the stored messages.
- The iPhone WebContainer failure. `Cross-Origin-Embedder-Policy` stays `credentialless`.
- Gas City. `resolved` on a question stays false.

## User stories

- As the Project Manager, I start the page from the same prompt the builder already shows, and I see the assistant reply in the chat column.
- As the Developer, I open the same project and see that reply without a second prompt box.
- As either role, I see a card when the workflow is waiting, and I can act only when the card is mine.
- As either role, I see the phase bar move when the other person approves, without reloading.
- As either role, I download the same file after the Project Manager approves Delivery.

## UX

### Flow

1. Both people sign in on the existing header. Normal Chrome is the Project Manager (`anakwannaphaschaiyong@gmail.com`, Google). Private Chrome is the Developer (`awannaphasch2016@fau.edu`, Microsoft).
2. The Project Manager types in `ChatBox` and presses Send. The Developer sees the same user line and the same assistant reply in `Messages`.
3. A card asks the Project Manager to move to Implementation. The Developer’s card says the step is waiting on the Project Manager.
4. After that approval, both phase bars show Implementation. The builder turn that starts the page is the existing Implementation kickoff, shown in the same chat.
5. A card asks the Developer the Implementation question. The Project Manager’s card waits.
6. The Developer answers. Both cards show answered. The Developer’s card can then move to Delivery. The Project Manager cannot.
7. Both phase bars show Delivery. A card asks the Project Manager to approve delivery. The Developer’s card waits.
8. Both phase bars show Delivered. Both see Download and receive the same file.
9. Reload keeps the phase, the chat, and Download.
10. Sign out. The project request is denied.

### States

- **Discovery, Project Manager:** `ChatBox` can send. The approval card can move to Implementation.
- **Discovery, Developer:** `ChatBox` cannot send. The card waits.
- **Implementation, Developer:** the question card can be answered, then the card can move to Delivery.
- **Implementation, Project Manager:** the card waits. No answer box.
- **Delivery, Project Manager:** the card can approve delivery.
- **Delivery, Developer:** the card waits.
- **Delivered, both:** Download is available. The card has no further approval.
- **Signed out:** the header offers Sign in. The project route returns 401.

### Card

Use `app/components/ui/Dialog.tsx`, mounted from `app/components/chat/BaseChat.tsx` in the same stack as `app/components/chat/ChatAlert.tsx`. The card is the only HITL surface. It is not a second transcript and not a second prompt.

The phase the people see is `app/components/factory/FactoryPhaseBar.tsx`, fed by the server snapshot. The local “Approve and continue” button is not a second approval path.

## Technical design

Four jobs stay separate.

| Job | Authority | This check |
| --- | --- | --- |
| Workflow | `wewebplus.project_state`, `questions`, `answers` | Keep the current role matrix and compare-and-set |
| Project | `wewebplus.messages` for chat `bolt-walkthrough-chat`, replayed into `useChat` | Store the real `/api/chat` turn, not a side completion |
| UI sync | The browser | Poll `GET /api/project` every 2 seconds and apply new message ids once |
| Permission | Clerk session plus `wewebplus.memberships` | Keep `app/lib/hitl/server.ts`. The card hides an action the server would reject |

A Durable Object would matter only when both browsers must see tokens while the model is still writing. Cloudflare can hold that WebSocket only with a Durable Object. It would broadcast the database. It would not store the phase or decide the role. `wrangler.jsonc` has no Durable Object, and this check does not add one.

The preview iframe in `app/components/workbench/Preview.tsx` shows this browser’s WebContainer. The other browser gets the same files by running new file actions from the stored assistant message through `app/lib/hooks/useMessageParser.ts` once. Shell actions that already ran are not run again.

### Permission matrix

| Action | Project Manager | Developer |
| --- | --- | --- |
| Send from `ChatBox` during Discovery | Allowed | 403 |
| Move Discovery to Implementation | Allowed | 403 |
| Answer the Implementation question | 403 | Allowed |
| Move Implementation to Delivery | 403 | Allowed |
| Approve Delivery | Allowed | 403 |
| Download after Delivered | Allowed | Allowed |
| Read the snapshot | Allowed | Allowed |

There is no Discovery question card and no Delivery question for the Developer. The transition is the approval. The Implementation question is the one card with an answer box.

### Components

Bolt source is `Awannaphasch2016/bolt.diy` on `cursor/website-walkthrough-55d6`. The Dyad deploy patch is what changes it.

Reuse without a new job:

- `app/components/chat/Messages.client.tsx`
- `app/components/chat/UserMessage.tsx`
- `app/components/chat/AssistantMessage.tsx`
- `app/components/chat/Artifact.tsx`
- `app/components/workbench/Workbench.client.tsx`
- `app/components/workbench/Preview.tsx`
- `app/components/ui/Dialog.tsx`
- `app/components/header/Header.tsx`
- `app/lib/hitl/server.ts` for the Clerk and membership check

Modify:

- `app/components/chat/ChatBox.tsx` — Send follows `canSend` from the snapshot. Remove the read-only walkthrough patch.
- `app/components/chat/Chat.client.tsx` — `sendMessage` still calls `useChat` and `POST /api/chat`. After the turn, store those messages on the project. Load the snapshot into the message list and the phase. The dialog confirm calls the existing `continuePrefill` / `factoryPhaseKickoff` path in `app/lib/factoryPhase.ts` so Implementation and Delivery still run the builder.
- `app/components/chat/BaseChat.tsx` — render the dialog beside `ChatAlert`. Stop treating `SharedProject` as the screen.
- `app/components/factory/FactoryPhaseBar.tsx` — show the server phase. Remove the `SharedProject` mount. Download sits here when the snapshot says the project is delivered.
- `app/lib/persistence/useChatHistory.ts` — the walkthrough chat id is `bolt-walkthrough-chat`. IndexedDB may cache it. The other browser reads Postgres.
- `scripts/doppler/bolt-workflow.mjs` — stop writing `SharedProject` and stop calling OpenRouter outside `/api/chat`. Keep the snapshot, the role checks, the compare-and-set, the Implementation question insert, and the document route.
- `scripts/doppler/patch-bolt-polyfills.mjs` — apply the chat integration instead of the panel patch.

Remove from the rendered page:

- `app/components/factory/SharedProject.tsx`
- `app/components/factory/HitlGateList.tsx`

Keep generating sign-in from `scripts/doppler/bolt-hitl.mjs`: `BoltSignIn.tsx`, `app/lib/hitl/client.ts`, and `app/lib/hitl/server.ts`.

### Data

No new role and no new organization. Re-seed still uses `on conflict do nothing` for `wewebplus.project_state`, so a deploy does not send the project back to Discovery.

`wewebplus.messages` stores the user message and the assistant message from `/api/chat`, including the text `useMessageParser` needs. Message ids are stable so a poll does not append the same row twice.

Delivery approval still writes `document_html` on the project row. Download fetches `/api/project/document` with the Clerk bearer token and saves that body. A plain link cannot send the token.

## Implementation

1. Remove the panel patch: no `SharedProject`, no read-only `ChatBox`, no disabled phase strip that hides the builder.
2. Teach the snapshot to include the stored `/api/chat` messages and the same permission flags the routes already enforce.
3. On Send, require the Project Manager during Discovery, call the existing chat route, then insert the finished messages.
4. On each poll, append unseen message ids into `useChat` and parse file actions once.
5. Show one dialog for the current gate: move to Implementation, answer the Developer question, move to Delivery, or approve Delivery.
6. Put Download on the phase bar after `delivered`.
7. Keep unsigned routes at 401, `credentialless`, `resolved: false`, and the development Clerk keys.

## Testing

Unit tests stay in `scripts/doppler/bolt-workflow.test.mjs` for the role matrix, the single answer, the compare-and-set, and the shared document. The patch test asserts the generated page mounts the dialog from `BaseChat` and does not render `SharedProject`.

The human check is the list below, on desktop Chrome, after a reload.

## Risks

| Risk | Mitigation |
| --- | --- |
| Replaying a shell action in the second browser runs the install twice | Apply each message id once. Replay file actions. Do not re-run shell actions |
| The second browser only sees a reply after the turn is stored | Accepted. Token streaming waits for a later Durable Object |
| The local phase and the server phase disagree | The snapshot overwrites the phase bar. IndexedDB is a cache |
| A deploy resets the project both people are using | `project_state` insert stays `on conflict do nothing` |

## Decisions

- The existing builder UI is the session. The panel was a parallel product and is removed.
- Postgres holds the phase, the messages, the question, the answer, and the download. Polling updates the UI.
- A Durable Object is not in this check.
- The transition is the approval, except the Implementation question, which has an answer box for the Developer only.
- Each browser builds its own preview from the stored messages. The download is the stored document, which both already verified.

## Checklist

- [ ] Both sessions show the builder prompt, the chat column, and the phase bar. No second prompt or transcript panel.
- [ ] The Project Manager sends from the large prompt. The Developer sees that turn in the chat column.
- [ ] The Developer cannot send during Discovery, and the server rejects it.
- [ ] The Project Manager’s card moves to Implementation. The Developer’s card waits, then the phase bar changes without a reload.
- [ ] The Implementation reply appears in the same chat column for both.
- [ ] The Developer’s card can answer the Implementation question. The Project Manager’s card waits, then shows answered.
- [ ] A second answer does not add a second row.
- [ ] Only the Developer’s card moves to Delivery. The server rejects the Project Manager.
- [ ] Only the Project Manager’s card approves Delivery. The server rejects the Developer.
- [ ] Both see Download and receive the same file.
- [ ] Reload keeps the phase, the chat, and Download.
- [ ] Sign out. The project is denied.
