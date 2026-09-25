type ChatMessageSnapshot = {
  role: string;
  content: string;
};

/**
 * A live patch stream is fresher than the database snapshot, so an in-progress
 * assistant reply already on screen must not be replaced. An empty thread, or
 * a thread that is still waiting for that reply, should take the snapshot.
 */
export function shouldApplyFetchedChatMessages({
  streaming,
  current,
  fetched,
}: {
  streaming: boolean;
  current: readonly ChatMessageSnapshot[] | undefined;
  fetched: readonly ChatMessageSnapshot[];
}): boolean {
  if (!current || current.length === 0) return fetched.length > 0 || !streaming;
  if (!streaming) return true;
  const last = current[current.length - 1];
  if (last?.role === "assistant" && last.content.length > 0) return false;
  return fetched.length > current.length;
}
