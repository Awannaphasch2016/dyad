import { ipc } from "@/ipc/types";
import { notePublishedSessionToken } from "./session_token_slot";

type TokenRead = () => Promise<string | null | undefined>;

type TokenJob = {
  read: TokenRead;
  settle: (stored: boolean) => void;
};

let latestJob: TokenJob | null = null;
let chain: Promise<void> = Promise.resolve();

/**
 * Store a Clerk session token. Resolves true only when this read's token was
 * written. A read that started for an older account is dropped when a newer
 * read is waiting, so the stored token matches the latest account.
 * `undefined` means the signed-in session has no token yet and must not clear
 * the one already stored. `null` signs out, after one turn so a newer
 * signed-in read can replace a brief signed-out flicker.
 */
export function publishSessionToken(readToken: TokenRead): Promise<boolean> {
  let settle!: (stored: boolean) => void;
  const result = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const job: TokenJob = { read: readToken, settle };
  latestJob?.settle(false);
  latestJob = job;
  const run = chain.then(async () => {
    while (latestJob) {
      const current = latestJob;
      latestJob = null;
      let token: string | null | undefined;
      try {
        token = await current.read();
      } catch (error) {
        current.settle(false);
        throw error;
      }
      if (latestJob || token === undefined) {
        current.settle(false);
        continue;
      }
      if (token === null) {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        if (latestJob) {
          current.settle(false);
          continue;
        }
      }
      try {
        await ipc.clerk.setSessionToken({ token });
      } catch (error) {
        current.settle(false);
        throw error;
      }
      notePublishedSessionToken(token);
      current.settle(true);
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Resolves when the newest queued token write has finished. */
export function sessionTokenPublishSettled(): Promise<void> {
  return chain;
}
