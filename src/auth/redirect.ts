/** Same-app return path. Anything else goes home so Clerk cannot open an external URL. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("://")) return "/";
  return value;
}
