# Bolt on the shared sign-in

Bolt is the first builder on the shared sign-in. DYAD, Forma, and Vibe SDK stay as they are until Bolt’s adapter passes the two-person check. The same Clerk application and the same Wewebplus membership rows are what those builders will use later.

This plan does not change Clerk’s production instance, does not delete users, and does not fill `bolt` / `prd`.

## What Bolt does today

Bolt has no sign-in page. The walkthrough at `https://bolt-walkthrough-55d6.karant-test-egress-canary.workers.dev` opens straight into chat. Chat history stays in that browser’s IndexedDB.

The preview Worker can already read a Clerk session and a `wewebplus.memberships` row for the question list. A signed-out request to `/api/hitl` returns `Sign in to continue.` and the question box stays hidden. The page never starts a Clerk session, so the two Wewebplus people cannot open the box.

Bolt’s Doppler preview config references the Clerk keys and `WEWEBPLUS_DATABASE_URL` from `dyad` / `preview`. Those names are Worker secrets. `bolt` / `prd` is empty.

The role rules the adapter must keep:

| Step | Phase | Who can answer |
| --- | --- | --- |
| `plan-approve` | Discovery | Project Manager |
| `review-approve-dev` | Implementation | Developer |
| `review-approve-pm` | Delivery | Project Manager |

The matching role sees the question text and can submit one answer. The other role in Wewebplus sees `Waiting on …` and no text. The answer returns `resolved: false`. The build stays paused.

## The adapter

The Bolt adapter is the only new sign-in work in this plan.

1. The walkthrough page gets a sign-in control that uses the Development publishable key.
2. The Gmail account signs in as Project Manager. The FU.edu account signs in as Developer. Both are members of Wewebplus.
3. A session with that one organization opens Wewebplus. There is no organization picker in this check.
4. The question list calls `/api/hitl` with the Clerk session cookie. The role comes from `wewebplus.memberships` for that Clerk user id.
5. Bolt does not grow a user table. Chat history stays in the browser.

The membership row keeps `org_id`. A later organization is another row and a selection step. This plan does not add organization creation.

Before the page uses the key, confirm the preview publishable key starts with `pk_test_`. A `pk_live_` key means the preview is pointed at production, and the work stops.

The two Development user ids go into `wewebplus.memberships` on the preview database. The same Gmail and FU.edu accounts can sign into Production later and will receive different user ids. Those Production ids are not part of this check.

## Check

Use Chrome on a computer. Open the walkthrough URL.

- Signed out: Discovery, Implementation, and Delivery still finish, and the phase bar has no question box.
- Normal window: Gmail account. The page shows Wewebplus and Project Manager.
- Private window: FU.edu account. The page shows Wewebplus and Developer.

With one stored question for each phase:

1. Discovery. The Project Manager sees the question text and submits `approve` once. The Developer sees `Waiting on Project Manager for plan-approve.`
2. Implementation. The Developer submits `approve` once. The Project Manager sees the waiting line.
3. Delivery. The Project Manager submits `approve` once. The Developer sees the waiting line.

After each submit the status is `answered`, the field is gone, and the build stays paused.

## After Bolt passes

Forma, Vibe SDK, and any remaining DYAD preview wiring copy this adapter: the same Development Clerk application, the same two users, and the same Wewebplus membership rows. Each of those builders still keeps its own project database. That work is a later plan.
