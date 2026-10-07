// Long-running GasCity side of the canary task.
// It calls the Dyad container at http://dyad:32100 and does not listen.

export const canaryBridgeUrl = "http://dyad:32100";

export async function checkBridge(baseUrl, fetchImpl = fetch) {
  const response = await fetchImpl(
    new URL("/v1/apps/0/factory-state", `${baseUrl}/`),
  );
  return { status: response.status };
}

export async function runSupervisor({
  baseUrl = canaryBridgeUrl,
  fetchImpl = fetch,
  sleep,
  log = () => {},
  signal,
}) {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error("The supervisor needs the Dyad bridge URL");
  }
  for (;;) {
    if (signal?.aborted) return;
    try {
      const result = await checkBridge(baseUrl, fetchImpl);
      log(`bridge ${result.status}`);
    } catch {
      log("bridge unreachable");
    }
    await sleep(signal);
  }
}

const isDirectRun = process.argv[1]?.endsWith("supervisor.mjs");
if (isDirectRun) {
  const stop = new AbortController();
  process.on("SIGTERM", () => stop.abort());
  runSupervisor({
    baseUrl: process.env.WEAVER_BASE_URL || canaryBridgeUrl,
    signal: stop.signal,
    log: (message) => console.log(message),
    sleep: (signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      }),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "supervisor failed");
    process.exitCode = 1;
  });
}
