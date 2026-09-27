import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { roleFromMetadata } from "@/lib/adminAccess";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import { loadClerkBrowser } from "./loadClerkBrowser";
import { ClerkSessionProvider, type ClerkSessionState } from "./session";

const clerkAppearance = {
  variables: {
    colorPrimary: "#6c55dc",
  },
};

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const publishableKey = useQuery({
    queryKey: queryKeys.clerk.publishableKey,
    queryFn: () => ipc.clerk.getPublishableKey(),
    staleTime: Infinity,
  });

  if (publishableKey.isPending) {
    return (
      <ClerkSessionProvider value={{ status: "loading" }}>
        {children}
      </ClerkSessionProvider>
    );
  }

  const key = publishableKey.data?.publishableKey ?? null;
  if (!key) {
    return (
      <ClerkSessionProvider value={{ status: "unconfigured" }}>
        {children}
      </ClerkSessionProvider>
    );
  }

  return (
    <ConfiguredClerkProvider publishableKey={key}>
      {children}
    </ConfiguredClerkProvider>
  );
}

function ConfiguredClerkProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  const [script, setScript] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    loadClerkBrowser(publishableKey).then(
      () => {
        if (!cancelled) setScript("ready");
      },
      () => {
        if (!cancelled) setScript("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publishableKey]);

  if (script === "failed") {
    return (
      <ClerkSessionProvider value={{ status: "unavailable" }}>
        {children}
      </ClerkSessionProvider>
    );
  }
  if (script !== "ready") {
    return (
      <ClerkSessionProvider value={{ status: "loading" }}>
        {children}
      </ClerkSessionProvider>
    );
  }

  return (
    <ClerkProviderWithRouter publishableKey={publishableKey}>
      {children}
    </ClerkProviderWithRouter>
  );
}

function ClerkProviderWithRouter({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate({ href: to })}
      routerReplace={(to) => navigate({ href: to, replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  );
}

function ClerkSessionBridge({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const value = useMemo<ClerkSessionState>(() => {
    if (!auth.isLoaded || !userLoaded) return { status: "loading" };
    if (!auth.isSignedIn || !auth.userId) return { status: "signed-out" };
    return {
      status: "signed-in",
      userId: auth.userId,
      roleId: roleFromMetadata(user?.publicMetadata),
      email: user?.primaryEmailAddress?.emailAddress ?? null,
    };
  }, [auth.isLoaded, auth.isSignedIn, auth.userId, userLoaded, user]);

  return <ClerkSessionProvider value={value}>{children}</ClerkSessionProvider>;
}
