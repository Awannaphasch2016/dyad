import { SignIn } from "@clerk/clerk-react";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { safeRedirect } from "@/auth/redirect";
import { useClerkSession } from "@/auth/session";
import { rootRoute } from "./root";
import { clerkAuthSearchSchema } from "./clerkAuthSearchSchema";

function SignInPage() {
  const search = signInRoute.useSearch();
  const session = useClerkSession();
  const navigate = useNavigate();
  const redirect = safeRedirect(search.redirect);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    void navigate({ href: redirect, replace: true });
  }, [session.status, navigate, redirect]);

  if (session.status === "unconfigured") {
    return (
      <div
        className="mx-auto max-w-md px-6 py-10"
        data-testid="sign-in-unconfigured"
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign-in is not configured
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Add the Clerk keys to the environment and reopen wewebplus. Until
          then, the app stays open without a login.
        </p>
        <Link
          to="/"
          className="mt-4 inline-block text-sm font-medium text-primary"
        >
          Back home
        </Link>
      </div>
    );
  }

  if (session.status !== "signed-out") {
    return (
      <p className="px-6 py-6 text-sm text-muted-foreground">
        Loading sign-in…
      </p>
    );
  }

  return (
    <div className="flex justify-center px-6 py-10" data-testid="clerk-sign-in">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl={redirect}
      />
    </div>
  );
}

export const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
  validateSearch: clerkAuthSearchSchema,
});
