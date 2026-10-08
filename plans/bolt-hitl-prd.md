# Multi-tenant HITL on bolt, then production

Bolt is the public web app and the web builder. Dyad is not the site people open. Production stays closed until the Maple Street Books checks pass on the public bolt URL.

## Bolt already has its own agent and its own page

The walkthrough page and the builder are one bolt app.

- The page is bolt's chat. Discovery, Implementation, and Delivery are bolt's phase bar.
- A send calls bolt's `/api/chat`. That route calls bolt's `streamText` in `app/lib/.server/llm/stream-text.ts`. The walkthrough pins that call to OpenRouter and `anthropic/claude-sonnet-5.5`.
- File actions run in that same browser through bolt's action runner and WebContainer.

Dyad's Electron agent is not on this path. A working bolt page does not need Dyad to build the site.

Two limits are already true:

- The chat transcript is in the browser's IndexedDB. A second person does not see it.
- The preview starts in Chrome on a computer and in Chrome on Android. On an iPhone it stays the known bug: WebKit ignores `credentialless`, so WebContainer does not start. That bug does not choose the production host.

## What has to be shared

The gate rules stay the ones Dyad already uses. `plan-approve` and `review-approve-pm` require the Project Manager. `review-approve-dev` requires the Developer. Another organization sees nothing. The other role in the same organization sees the waiting line and not the text.

Those questions cannot live in IndexedDB. The Project Manager, the Developer, and Gas City are not the same browser. Bolt stores the question and the answer in `wewebplus`, the same tables the closer already reads.

Sign-in is the existing Wewebplus Clerk user. The Worker checks the session, reads that person's organization and role, and applies the same show-or-hide rules. The posted JSON still does not name an organization. The app's owner is the organization.

Bolt's phase bar shows the question card. Submit writes one `wewebplus.answers` row and returns that the gate is not closed. A second submit does not write another row. Bolt does not run `hitl.py`.

## Gas City

The rig stays `multi tenant HITL`. The closer stays `scripts/gascity/resolve_hitl_answer.py`. It runs `hitl.py respond`, then `hitl.py release`, and sets `gate_resolved_at` only after both exit 0.

Gas City posts to the bolt Worker, not to Electron on `127.0.0.1:32100`. The body is the same: `runId`, `stepId`, `targetRoleId`, `body`, `idempotencyKey` of `<runId>:<stepId>`, and `gateBeadId`. The URL names the app and the phase.

The recipe waits on that bead. A finished model summary and a preview do not release it. After `hitl.py release`, the next agent step calls bolt's `/api/chat`. It does not call Dyad. Bolt stores that reply on the server so both roles can read it. The signed-in browser applies file actions and shows the preview.

## Example

Wewebplus owns Maple Street Books. Harbor owns a different app. Both people open the public bolt URL and sign in. Gas City run `run-maple-1` uses the rig `multi tenant HITL`.

After Discovery, Gas City posts `plan-approve` for the Project Manager, with the bookshop summary in the text, and waits. The Wewebplus Project Manager sees the text and submits `approve`. The Wewebplus Developer sees only the waiting line. Harbor does not see the question. One answer is stored. The gate is not closed yet.

The closer releases `run-maple-1`. Gas City then asks bolt's agent to build the page. The same handoff happens for `review-approve-dev` during Implementation and `review-approve-pm` during Delivery. Harbor's open question is still open.

## Production

`bolt` / `prd` stays empty until the checks pass on the preview URL `https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev`.

After they pass, `prd` references the same Cloudflare names and `OPEN_ROUTER_API_KEY` that preview already uses. The production Worker is deployed from that config. People use that public URL. Dyad is not deployed as the site. Secrets stay in Doppler. Nothing is copied into GitHub secrets on `bolt.diy`.

## Out of scope

Fixing the iPhone preview. Running the closer inside the Worker. Calling `bd` from the page.

## Checks

1. On the public bolt URL, a send is answered by bolt's `/api/chat`, not by Dyad.
2. Gas City posts one `plan-approve` question for Maple Street Books, owned by Wewebplus.
3. The Wewebplus Project Manager sees the plan text and can submit. The Wewebplus Developer sees only the waiting line. Harbor does not see the question.
4. One submit stores one answer. A second submit does not store another. The response still says the gate is not closed.
5. The closer runs `hitl.py respond` and then `hitl.py release` on rig `multi tenant HITL`, and only then sets `gate_resolved_at`.
6. After release, the next build reply comes from bolt's agent. Then Gas City posts `review-approve-dev`. Only the Wewebplus Developer can answer it.
7. After that release, Gas City posts `review-approve-pm`. Only the Wewebplus Project Manager can answer it.
8. Harbor's open question is still open after Maple Street's three answers are stamped.
9. The preview is judged in Chrome on a computer or Chrome on Android. The iPhone preview bug stays open and does not block production.
10. After those checks, `bolt` / `prd` is deployed and is the public URL. Dyad is not the public site.
