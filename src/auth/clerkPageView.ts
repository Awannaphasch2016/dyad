import type { ClerkSessionState } from "./session";

/**
 * Clerk's SignIn/SignUp components throw unless ClerkProvider is mounted.
 * That provider exists only after the script loads and the session can be
 * signed-out or signed-in. OAuth returns to /sign-in/sso-callback while the
 * script is still loading, so the callback route must wait instead of
 * mounting the widget early.
 */
export function clerkPageView(
  status: ClerkSessionState["status"],
): "unconfigured" | "unavailable" | "pending" | "form" {
  if (status === "unconfigured" || status === "unavailable") return status;
  if (status === "signed-out") return "form";
  return "pending";
}
