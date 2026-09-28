import { ipc } from "@/ipc/types";

let latestRead: (() => Promise<string | null>) | null = null;
let chain: Promise<void> = Promise.resolve();

/**
 * Store a Clerk session token. A read that started for an older account is
 * dropped when a newer read is waiting, so the stored token matches the
 * latest account.
 */
export function publishSessionToken(
  readToken: () => Promise<string | null>,
): Promise<void> {
  latestRead = readToken;
  const run = chain.then(async () => {
    while (latestRead) {
      const read = latestRead;
      latestRead = null;
      const token = await read();
      if (latestRead) continue;
      await ipc.clerk.setSessionToken({ token });
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
