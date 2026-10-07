# Stop the waiting screen from saving “no chat selected”

> Revised 2026-10-06 for approval. The return from a closed Safari tab stays. This revision fixes the stuck “Loading chats...” screen that return added.

## Points to approve

1. Tapping Discovery opens that chat. The messages appear. The app stays selected.
2. “Loading chats...” is only a wait. It does not change which chat is selected, and it does not save “no chat selected.”
3. The saved tab note changes only when you open a chat, switch chats, or close a chat tab with that tab’s close control.
4. A new tab waits until the app list has arrived. “App not found” appears only after that, and only when this preview’s database has no such app. The tab title shows the app name once the list arrives.
5. Messages, the app, and the files stay in the preview database and the app folder. Words typed in the box and not yet sent stay in the tab’s memory.
6. The delivery document may still open as its own page. The login cookie stays. A chat tab you closed yourself stays closed. If the database really has none of the saved chats, the one card and **App list** stay.
7. The white Implementation preview, Neon, and the Postgres driver stay out.

## What went wrong

The return is already on preview 44. It copies the saved tab list onto the next visit so a closed Safari tab can reopen the same chats.

Opening a chat now waits on “Loading chats...” until the server confirms the chat. That wait sets the selected chat to none so the message pane will not toast “Chat not found” while the answer is in flight. The tab note saves every change of the selected chat, including none. The wait reads that note. The save changes the note, so the wait cancels the answer and starts again. The screen stays on “Loading chats...”. friendly-phoenix-dive is still in the database.

A new tab’s app list starts empty. The app page treats an empty list as “App not found,” so the tab title falls back to “App 1” until the list arrives. If the list never replaces that screen, the app looks missing.

## What the person sees

1. You create an app. Discovery, Implementation, and Delivery are in the sidebar.
2. You tap Discovery. The chat opens. The header shows the app name. The messages are there.
3. You leave the site, or you open the same address in a new tab, and you come back.
4. You are still signed in. The chat you left open is open, with its messages. A chat tab you closed with the tab’s close control stays closed.
5. Only when this preview’s database has already lost that chat: one card, **This chat is not on this preview.** **App list** opens the home screen. It does not recreate the chat.

## What we will change

The waiting screen may still ask the server when the chat is not already in the loaded list. It must not set the selected chat or the selected app to none while it asks. A chat that is already in the loaded list opens immediately.

The app page uses the app list’s loading state. While that list is loading, the page waits. “App not found” is the result after the list has loaded and the id is absent.

Files:

- `src/pages/chat.tsx` — stop clearing the selected chat and the selected app at the start of the wait. Open a chat that is already loaded. Keep the one card for a chat the database does not have.
- `src/pages/app-details.tsx` — wait for the app list before showing “App not found.”

Unchanged: the tab-note saver, the window id, `src/lib/factoryDocuments.ts`, the login cookie, SQLite, the app folder, the bridge, Neon, and `postgres`.

## What we will not change

- Where messages are stored. They stay in the preview database.
- Words you have typed and have not sent. They stay in the tab’s memory.
- The delivery document opening as its own page.
- The white Implementation preview.
- Rekeying the tab note away from the window id. The note already survives a new visit. The bug is the wait writing “none” into it.

## How we will check it

- A test that opens a chat already in the loaded list does not set the selected chat to none.
- A test that the app page shows a wait while the app list is loading, and “App not found” only after the list has loaded without that id.
- On the preview: tap Discovery and the messages appear. Open the address in a new tab and the app name appears after the list loads.

## Limit

If the preview database no longer contains the app, the card is the right screen. This change does not invent that app.

## Decision log

- The return from a closed Safari tab stays. This revision only stops the wait from saving “no chat selected.”
- The tab note and the wait were sharing one value. The wait stops writing that value.
- Unsent text in the box is a different lifetime. It is out of this change.
- “App not found” before the list loads is the same class of mistake: a not-yet-loaded list is not a missing app.
