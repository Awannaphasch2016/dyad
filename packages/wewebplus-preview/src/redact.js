const SECRET =
  /nsrt_[A-Za-z0-9._-]+|dp\.st\.[A-Za-z0-9._-]+|CLOUDFLARE_TUNNEL_TOKEN=\S+/g;

export function redact(text) {
  return String(text).replace(SECRET, (match) =>
    match.startsWith("CLOUDFLARE_TUNNEL_TOKEN=")
      ? "CLOUDFLARE_TUNNEL_TOKEN=<redacted>"
      : "<redacted>",
  );
}
