import {
  ClerkProvider,
  useAuth,
  useOrganization,
  useUser,
} from "@clerk/clerk-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { clerkCanInvite, roleFromClerkMembership } from "@/lib/adminAccess";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import { loadClerkBrowser } from "./loadClerkBrowser";
import { publishSessionToken } from "./publish_session_token";
import { refreshSessionTokenIfNeeded } from "./refresh_session_token";
import { ClerkSessionProvider, type ClerkSessionState } from "./session";
import {
  SESSION_TOKEN_REFRESH_RETRY_MS,
  sessionTokenRefreshDelayMs,
  storedSessionTokenNeedsRefresh,
} from "./session_token_lifetime";
import { registerSessionTokenEnsure } from "./session_token_ipc";
import { lastPublishedSessionToken } from "./session_token_slot";

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
  const { organization, membership, isLoaded: orgLoaded } = useOrganization();
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    if (!auth.isLoaded) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setTokenReady(false);

    const issue = async () => {
      if (!auth.isSignedIn) return null;
      // Skip Clerk's cache. The cached JWT is the one about to expire.
      const token = await auth.getToken({ skipCache: true });
      return token || undefined;
    };

    const arm = (token: string | null | undefined) => {
      if (!active || !auth.isSignedIn) return;
      clearTimeout(timer);
      const delay =
        typeof token === "string"
          ? sessionTokenRefreshDelayMs(token)
          : SESSION_TOKEN_REFRESH_RETRY_MS;
      timer = setTimeout(() => {
        void publish(false, false);
      }, delay);
    };

    const publish = (markLoading: boolean, force: boolean) => {
      if (!active) return Promise.resolve(false);
      if (markLoading) setTokenReady(false);
      let issued: string | null | undefined;
      const read = async () => {
        issued = await issue();
        return issued;
      };
      // Identity changes always copy a new JWT. The previous one can still be
      // inside its lifetime while naming the previous organization.
      const storedToken = force
        ? publishSessionToken(read)
        : refreshSessionTokenIfNeeded(read);
      return storedToken
        .then((stored) => {
          if (!active) return stored;
          if (stored && auth.isSignedIn) setTokenReady(true);
          arm(issued ?? lastPublishedSessionToken());
          return stored;
        })
        .catch(() => {
          if (active) arm(undefined);
          return false;
        });
    };

    // Chat and proposal ask the main process, which can only verify this copy.
    registerSessionTokenEnsure(() => {
      if (!active || !auth.isSignedIn) return null;
      if (!storedSessionTokenNeedsRefresh(lastPublishedSessionToken())) {
        return null;
      }
      return publish(false, false).then(() => undefined);
    });

    void publish(true, true);

    const onVisible = () => {
      if (document.visibilityState !== "visible" || !auth.isSignedIn) return;
      void publish(false, false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      registerSessionTokenEnsure(null);
    };
  }, [auth.isLoaded, auth.isSignedIn, auth.orgId, auth.userId, auth.getToken]);

  const value = useMemo<ClerkSessionState>(() => {
    if (!auth.isLoaded || !userLoaded || !orgLoaded)
      return { status: "loading" };
    if (!auth.isSignedIn || !auth.userId) return { status: "signed-out" };
    if (!tokenReady) return { status: "loading" };
    const account = organization
      ? {
          type: "org" as const,
          id: organization.id,
          name: organization.name,
        }
      : { type: "user" as const, id: auth.userId, name: "Private" };
    return {
      status: "signed-in",
      userId: auth.userId,
      roleId: organization
        ? roleFromClerkMembership(membership?.publicMetadata, membership?.role)
        : null,
      canInvite: organization ? clerkCanInvite(membership?.role) : false,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      displayName: user?.fullName ?? user?.primaryEmailAddress?.emailAddress,
      account,
    };
  }, [
    auth.isLoaded,
    auth.isSignedIn,
    auth.userId,
    userLoaded,
    orgLoaded,
    user,
    organization,
    membership,
    tokenReady,
  ]);

  return <ClerkSessionProvider value={value}>{children}</ClerkSessionProvider>;
}
