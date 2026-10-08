// The public preview iframe cannot open the container's localhost proxy.
// A hostname under apps.<page host> stays a different origin from the Dyad page.

import {
  PROXY_FALLBACK_MAX_ATTEMPTS,
  PROXY_FALLBACK_PORT_START,
  PROXY_PORT_BASE,
  PROXY_PORT_RANGE,
} from "../../shared/ports";

const APEX_HOSTS = new Set([
  "anakwannaphaschaiyong.com",
  "www.anakwannaphaschaiyong.com",
]);

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

export function isPreviewAppsHost(host: string): boolean {
  return /^\d+\.apps\./.test(hostnameOf(host));
}

export function previewPortFromHost(host: string): number | null {
  const hostname = hostnameOf(host);
  const match = /^(\d+)\.apps\.(.+)$/.exec(hostname);
  if (!match) return null;
  const port = Number(match[1]);
  const parent = match[2] ?? "";
  if (!parent || APEX_HOSTS.has(parent) || !isPreviewProxyPort(port)) {
    return null;
  }
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
  return `${page.protocol}//${port}.apps.${page.hostname}${path}`;
}
