import { ipc } from "@/ipc/types";

let latestRead: (() => Promise<string | null | undefined>) | null = null;
let chain: Promise<void> = Promise.resolve();

/**
 * Store a Clerk session token. A read that started for an older account is
 * dropped when a newer read is waiting, so the stored token matches the
 * latest account. `undefined` means the signed-in session has no token yet
 * and must not clear the one already stored. `null` signs out, after one
 * turn so a newer signed-in read can replace a brief signed-out flicker.
 */
export function publishSessionToken(
  readToken: () => Promise<string | null | undefined>,
): Promise<void> {
  latestRead = readToken;
  const run = chain.then(async () => {
    while (latestRead) {
      const read = latestRead;
      latestRead = null;
      const token = await read();
      if (latestRead || token === undefined) continue;
      if (token === null) {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        if (latestRead) continue;
      }
      await ipc.clerk.setSessionToken({ token });
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
