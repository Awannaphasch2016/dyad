const unconfigured = "The preview listener is not configured.";

export function assertPreviewGasCityUrl(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.VERCEL_ENV !== "preview") return;
  const value = env.NEXT_PUBLIC_GAS_CITY_URL?.trim() ?? "";
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_GAS_CITY_URL is required for a preview deployment",
    );
  }
}

export function gasCityRunsUrl(env: NodeJS.ProcessEnv = process.env): string {
  const origin = env.NEXT_PUBLIC_GAS_CITY_URL?.trim() ?? "";
  if (!origin || origin.startsWith("/")) {
    throw new Error(unconfigured);
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(unconfigured);
  }
  if (url.protocol !== "https:" || url.hostname.length === 0) {
    throw new Error(unconfigured);
  }
  url.pathname = "/v1/runs";
  url.search = "";
  url.hash = "";
  const target = url.toString();
  if (target.startsWith("/")) throw new Error(unconfigured);
  return target;
}

export async function postPreviewPrompt(
  input: { prompt: string; idempotencyKey: string; token: string },
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const url = gasCityRunsUrl(env);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Enter a prompt.");
  if (!input.token) throw new Error("Sign in to continue.");
  return fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      idempotencyKey: input.idempotencyKey,
    }),
  });
}
