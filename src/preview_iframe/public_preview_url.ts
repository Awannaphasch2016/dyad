// The public preview iframe cannot open the container's localhost proxy.
// p<port>.anakwannaphaschaiyong.com is a different origin from the Dyad page
// and is covered by the existing one-level certificate.

import {
  PROXY_FALLBACK_MAX_ATTEMPTS,
  PROXY_FALLBACK_PORT_START,
  PROXY_PORT_BASE,
  PROXY_PORT_RANGE,
} from "../../shared/ports";

const APEX_HOSTNAME = "anakwannaphaschaiyong.com";
const CANARY_PAGE_HOSTNAME = "pre.anakwannaphaschaiyong.com";

// The canary page frames the generated app. The preview proxy adds this
// origin to frame-ancestors only when the bridge names it on the request.
export const CANARY_PAGE_ORIGIN = `https://${CANARY_PAGE_HOSTNAME}`;

export function isPreviewProxyPort(port: number): boolean {
  return (
    (port >= PROXY_PORT_BASE && port < PROXY_PORT_BASE + PROXY_PORT_RANGE) ||
    (port >= PROXY_FALLBACK_PORT_START &&
      port < PROXY_FALLBACK_PORT_START + PROXY_FALLBACK_MAX_ATTEMPTS)
  );
}

function hostnameOf(host: string): string {
  return host.split(":")[0]?.trim().toLowerCase() ?? "";
}

export function isCanaryPageHost(host: string): boolean {
  const hostname = hostnameOf(host);
  return (
    hostname === CANARY_PAGE_HOSTNAME ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

export function isPreviewAppsHost(host: string): boolean {
  return /^p\d+\.anakwannaphaschaiyong\.com$/.test(hostnameOf(host));
}

export function refusesPublicHost(host: string): boolean {
  const hostname = hostnameOf(host);
  if (!hostname || isCanaryPageHost(hostname)) return false;
  return hostname === APEX_HOSTNAME || hostname.endsWith(`.${APEX_HOSTNAME}`);
}

export function previewPortFromHost(host: string): number | null {
  const match = /^p(\d+)\.anakwannaphaschaiyong\.com$/.exec(hostnameOf(host));
  if (!match) return null;
  const port = Number(match[1]);
  if (!isPreviewProxyPort(port)) return null;
  return port;
}

function isLoopbackPage(page: URL): boolean {
  return (
    page.hostname === "localhost" ||
    page.hostname === "127.0.0.1" ||
    page.hostname === "[::1]" ||
    page.hostname === "::1"
  );
}

export function publicPreviewUrl(
  pageUrl: string,
  proxyUrl: string | null | undefined,
): string | null {
  if (!proxyUrl) return null;
  let page: URL;
  let proxy: URL;
  try {
    page = new URL(pageUrl);
    proxy = new URL(proxyUrl);
  } catch {
    return proxyUrl;
  }
  if (isLoopbackPage(page)) return proxyUrl;
  const loopbackProxy =
    proxy.hostname === "localhost" || proxy.hostname === "127.0.0.1";
  const port = Number(proxy.port);
  if (
    !loopbackProxy ||
    (proxy.protocol !== "http:" && proxy.protocol !== "https:") ||
    !isPreviewProxyPort(port)
  ) {
    return proxyUrl;
  }
  const path = `${proxy.pathname}${proxy.search}${proxy.hash}`;
  return `${page.protocol}//p${port}.${APEX_HOSTNAME}${path}`;
}
