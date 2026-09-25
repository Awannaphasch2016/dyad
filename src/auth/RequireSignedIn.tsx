import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useClerkSession } from "./session";

/** Home, sign-in, and sign-up stay public. Other factory routes use this gate. */
export function RequireSignedIn({ children }: { children: ReactNode }) {
  const session = useClerkSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (session.status !== "signed-out") return;
    const redirect = `${location.pathname}${location.searchStr}${location.hash}`;
    void navigate({
      to: "/sign-in",
      search: { redirect },
      replace: true,
    });
  }, [
    session.status,
    location.pathname,
    location.searchStr,
    location.hash,
    navigate,
  ]);

  if (session.status === "unconfigured" || session.status === "signed-in") {
    return children;
  }

  return (
    <p
      className="px-6 py-6 text-sm text-muted-foreground"
      data-testid="auth-checking"
    >
      Checking sign-in…
    </p>
  );
}
