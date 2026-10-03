const unconfigured = "The preview listener is not configured.";

export function gasCityAbsoluteUrl(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const origin = env.NEXT_PUBLIC_GAS_CITY_URL?.trim() ?? "";
  if (
    !origin ||
    origin.startsWith("/") ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//")
  ) {
    throw new Error(unconfigured);
  }
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw new Error(unconfigured);
  }
  if (base.protocol !== "https:" || base.hostname.length === 0) {
    throw new Error(unconfigured);
  }
  const target = new URL(pathname, `${base.protocol}//${base.host}`);
  if (
    target.protocol !== "https:" ||
    target.host !== base.host ||
    target.hostname.length === 0
  ) {
    throw new Error(unconfigured);
  }
  const value = target.toString();
  if (value.startsWith("/")) throw new Error(unconfigured);
  return value;
}

export async function callGasCity(
  pathname: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const url = gasCityAbsoluteUrl(pathname, env);
  return fetchImpl(url, init);
}

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
  return gasCityAbsoluteUrl("/v1/runs", env);
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
