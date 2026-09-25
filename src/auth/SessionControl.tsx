import { UserButton } from "@clerk/clerk-react";
import { Link, useLocation } from "@tanstack/react-router";
import { useClerkSession } from "./session";

export function SessionControl() {
  const session = useClerkSession();
  const location = useLocation();

  if (session.status === "unconfigured" || session.status === "loading") {
    return null;
  }

  if (session.status === "signed-out") {
    if (location.pathname === "/sign-in" || location.pathname === "/sign-up") {
      return null;
    }
    const redirect = `${location.pathname}${location.searchStr}${location.hash}`;
    return (
      <Link
        to="/sign-in"
        search={{ redirect }}
        className="no-app-region-drag mr-3 shrink-0 text-sm font-medium text-primary"
        data-testid="title-bar-sign-in"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div
      className="no-app-region-drag mr-3 flex shrink-0 items-center"
      data-testid="title-bar-user-button"
    >
      <UserButton />
    </div>
  );
}
