import { GAS_CITY_PATHS } from "./contract";

/**
 * Direct GasCity client. When NEXT_PUBLIC_GAS_CITY_URL is set, the browser
 * calls that origin. Otherwise it calls the same-origin contract routes,
 * which exist so a Vercel preview can speak the contract before a public
 * GasCity host is attached. Neither path opens Electron.
 */
export function gasCityOrigin(): string {
  return process.env.NEXT_PUBLIC_GAS_CITY_URL?.trim().replace(/\/$/, "") ?? "";
}

export async function gasCityFetch(
  path: string,
  init: RequestInit | undefined,
  sessionToken: string | null,
): Promise<Response> {
  const origin = gasCityOrigin();
  const headers = new Headers(init?.headers);
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${origin}${path}`, {
    ...init,
    headers,
    credentials: origin ? "omit" : "include",
    cache: "no-store",
  });
}

export const gasCityPaths = GAS_CITY_PATHS;
