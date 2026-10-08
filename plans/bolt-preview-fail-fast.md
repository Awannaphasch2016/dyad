# Fail fast when the walkthrough preview cannot start

The Implementation preview stays on **No preview available**, and `package.json` stays on an open circle. The chat can still say the page was built. Nothing is serving the page, and nothing reports why.

This plan makes that boot failure throw, with the two values that disagree named in the error. It does not add another preview path.

## Cause

`app/lib/webcontainer/index.ts` boots with `coep: 'credentialless'`.

The live walkthrough answers with `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`. That header is set in `app/entry.server.tsx`. The comment above it says the header should be `credentialless`, because `require-corp` blocks third-party subresources. The code kept the WebContainer documentation default, `require-corp`.

Those two values have to be the same. `WebContainer.boot` does not finish when they differ. `#runFileAction` waits on that promise before it writes the file. A promise that never settles never reaches the `failed` status, so the row stays open and the Preview tab keeps the empty state `No preview available`.

## One value

Add `app/lib/webcontainer/coep.ts` and export one constant:

```ts
export const WEBCONTAINER_COEP = "credentialless" as const;
```

`credentialless` is the value the boot call and the server comment already chose. `require-corp` stays out. Do not pick it when boot fails.

- `app/entry.server.tsx` sets `Cross-Origin-Embedder-Policy` from `WEBCONTAINER_COEP`. `Cross-Origin-Opener-Policy` stays `same-origin`.
- `app/lib/webcontainer/index.ts` passes `coep: WEBCONTAINER_COEP` to `WebContainer.boot`.

## Boot must reject

Wrap the boot promise. If it has not resolved within 15 seconds, reject it. The message names the expected header and says the boot did not start:

```text
WebContainer did not start. Expected Cross-Origin-Embedder-Policy: credentialless.
```

Do not retry with `require-corp`. Do not leave the promise pending. Do not render a substitute page.

If `WebContainer.boot` itself rejects, keep that rejection and put the same expected header on the message.

## Show the rejection

`app/lib/runtime/action-runner.ts` already marks a thrown file action `failed`. A hang never throws, so that path never runs. After the boot promise rejects, the `package.json` row goes to `failed` and the row text is the boot message, not the generic `Action failed`.

`app/components/workbench/Preview.tsx` shows **No preview available** only when boot succeeded and no server is listening. When boot rejected, the pane shows the boot message.

## Where it lands

The change is in `Awannaphasch2016/bolt.diy` on `cursor/website-walkthrough-55d6`, in:

- `app/lib/webcontainer/coep.ts`
- `app/lib/webcontainer/index.ts`
- `app/entry.server.tsx`
- `app/lib/runtime/action-runner.ts`
- `app/components/workbench/Preview.tsx`
- a unit test next to `coep.ts`

The walkthrough deploy already checks out that ref. The next deploy of `cursor/bolt-doppler-55d6` publishes it. Doppler and the OpenRouter secret stay as they are.

## Test

The unit test imports `WEBCONTAINER_COEP` and reads `app/entry.server.tsx` and `app/lib/webcontainer/index.ts`. Both files must contain that constant. The test fails if either side writes `require-corp` again.

A second test feeds a boot promise that never resolves and asserts the wrapper rejects with the expected header before the file action can stay pending.

## Done when

- The walkthrough response header is `Cross-Origin-Embedder-Policy: credentialless`.
- Boot uses that same value.
- A boot that does not start marks `package.json` failed and replaces **No preview available** with the boot message within 15 seconds.
- The unit tests above pass.
