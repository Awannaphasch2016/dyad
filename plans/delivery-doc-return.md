# Restore the signed-in workspace when the browser tab closes

> Revised 2026-10-06 for approval. The delivery document may open as its own page. This plan is the return.

## Points to approve

1. Opening the delivery document as its own page stays as it is. This plan does not add a box on the chat page.
2. Closing the Safari tab, or Safari leaving the chat to show that document, is an accident. The next visit to this site opens the same account and the same chats.
3. There is no sign-in step on that return while the existing login cookie is still valid.
4. Chats that were open are open again. The chat you were reading is the one selected. Messages and the app are the ones already saved on this preview.
5. A chat tab you closed yourself, with that tab's close control, stays closed. The chat remains in the sidebar.
6. The app list is the home screen of apps this preview still has. A button to that list is only for a link whose chat and app are already absent from this preview. That button does not recreate them.
7. The white Implementation preview, Neon, and the Postgres driver stay out.

## What went wrong

On `https://pr-43.anakwannaphaschaiyong.com` you finished Noodle House and tapped **Download documentation**. Safari replaced the tab with the HTML file. When you came back, the address still named that chat and that app. The page tried to open them before it knew they were there. You saw `DyadError: Chat not found`, `DyadError: App not found`, **Error loading proposal**, **No messages yet**, and **Preparing preview**.

The download did not delete the work. Two memories were involved, and the return threw one of them away.

- **Who you are** lives in the Clerk cookie on the iPad. A new window id does not replace it. The page must leave that cookie in place.
- **Which chat tabs are open, which one is selected, and which tabs you closed yourself** lives on the iPad under `chat-tab-session-v2:<window id>`. Closing the Safari tab drops that window id. The next visit mints a new one. Today the iPad skips copying the old list onto the new id, then deletes the old list, because the copy is allowed only for the first desktop window.
- **The messages, the app list, and the site files** live on the preview's disk (`config` for the database, `projects` for the app files). A browser-tab close must keep using those same files.

## What the person sees

### The return that brings the chat back

1. You are signed in on Noodle House. That chat tab is open. Any chat tab you already closed stays closed.
2. You tap **Download documentation**. Safari may show the file in this tab. The login cookie, the saved tab list, and the saved app stay.
3. You open the site again. You see **Checking sign-in…**, then **Loading chats...**. You are not taken to the sign-in page.
4. The page finds that chat in the preview's database and opens it. The thread, the preview, and the phase tabs you had open are back.
5. You continue from where you left off.

### The app list, only when this preview has already lost that chat

This is not the way back to Noodle House.

1. You return, still signed in.
2. The saved list names a chat. This preview's database has no such chat and no such app.
3. The thread and the preview stay off the screen. One card is the whole page. Heading: **This chat is not on this preview.** Body: **The saved tab points at a chat this preview does not have.** Button: **App list.**
4. You tap **App list**. You land on `/`, the home screen. It lists the apps still stored on this preview.
5. An app that is absent from that database is absent from the list. The button does not create it.

## What we will change

The download code stays as it is.

On the iPad's next visit, before any cleanup, copy the newest saved tab list onto the new window id. The copy includes the open tabs, the selected tab, and the tabs you closed yourself. The new window id is then one of the ids cleanup is allowed to keep, so the copy survives. A second desktop window still does not take another window's tabs. The iPad's saved list and the desktop window's saved list are separate.

Do not sign out, and do not clear cookies or the saved tab list, when the bridge disconnects or the page unloads.

Do not draw the chat or the preview until the preview's database confirms the chat. If one saved tab is missing and another saved tab is present, open the one that is present. If every saved tab is missing, show the card above. Other errors stay on the current error path. The server still refuses a chat or app the account cannot see.

Files:

- `src/window_infrastructure/chat_tab_session_restore.ts` — new helper. The browser-bridge visit copies the old list and keeps the new window id. Any other window keeps today's rule.
- `src/ipc/handlers/window_infrastructure_handlers.ts` — bootstrap uses that helper.
- `src/pages/chatMissingRoute.ts` — `Chat not found` and `App not found` are the two messages that mean "this row is absent." `Chat not found: 3` is not one of them.
- `src/pages/chat.tsx` — confirm the chat before selecting it or mounting the panels. Show the card only when every restored tab is absent. **App list** goes to `/`.
- `src/i18n/locales/*/chat.json` — the card sentences.

Unchanged: `src/lib/factoryDocuments.ts`, `src/components/chat/FactoryPhaseBar.tsx`, `src/control_plane/guard.ts`, `src/hooks/useProposal.ts`, `src/main/browser_bridge.ts`, `src/auth/RequireSignedIn.tsx`, `src/auth/ClerkAuthProvider.tsx`, the preview iframe, Neon, and `postgres`.

## What we will not change

- The delivery document. It may open as its own page.
- The white Implementation preview.
- Where chats are stored. They stay in the preview database on the `config` volume. App files stay on the `projects` volume. This change does not copy them into the browser and does not move them to Neon.
- The bridge disconnect toast, the bridge retry, and container restart.
- A second desktop window's tabs.

## How we will check it

- A browser-bridge visit copies a saved list that has chat 20 open and chat 10 closed. After cleanup, chat 20 is open and chat 10 is closed.
- The same cleanup, told to keep only an unrelated desktop window id, deletes the saved list. That is the bug.
- A desktop window that is not the first window does not copy another window's list.
- `Chat not found` and `App not found` match the card. A longer message does not.
- Run `npm test -- src/window_infrastructure/chat_tab_session_restore.test.ts src/window_infrastructure/chat_tab_session_storage.test.ts src/pages/chatMissingRoute.test.ts`.
- On the preview, after this is deployed: open the delivery document so Safari leaves the chat, come back, and the same account and the same open chats are there. A chat tab closed with the tab's own close control stays closed.

## Limit

If the preview's database file no longer contains Noodle House, copying the tab list cannot invent the messages. The card and the app list are that case. They keep you signed in and they stop the error popups and the endless preview spinner. Recovering a database that was already empty is a separate investigation. This change does not delete that file, does not start a new empty one, and does not restart the container because a browser tab closed.

## Decision log

- The in-page document viewer is out. It would avoid one unload and would still forget a closed Safari tab.
- The return is the product. Same cookie, same open tabs, same saved chats.
- A tab closed inside Dyad stays closed. A Safari tab closed by mistake does not write those chats into the closed list.
- **App list** means the home screen. It is not a restore action.
- The server's refusal strings stay. The page stops showing them as popups while it is confirming a restored tab.

---

_Revised for approval. The document may open as its own page. The return restores the signed-in workspace._
