import { callGasCity, gasCityAbsoluteUrl } from "../gas_city_url";
import { GAS_CITY_PATHS } from "./contract";

const unconfigured = "The preview listener is not configured.";

/**
 * Browser client for an absolute https GasCity origin. A missing, relative,
 * or non-https NEXT_PUBLIC_GAS_CITY_URL throws before fetch. This app is not
 * a stand-in for GasCity.
 */
export function gasCityOrigin(env: NodeJS.ProcessEnv = process.env): string {
  try {
    return new URL(gasCityAbsoluteUrl("/", env)).origin;
  } catch (error) {
    if (error instanceof Error && error.message === unconfigured) return "";
    throw error;
  }
}

export async function gasCityFetch(
  path: string,
  init: RequestInit | undefined,
  sessionToken: string | null,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return callGasCity(
    path,
    {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    },
    fetchImpl,
    env,
  );
}

export const gasCityPaths = GAS_CITY_PATHS;
