import {
  useAuth,
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "jotai";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { OrganizationMark } from "./OrganizationMark";
import {
  readLastAccount,
  restoreLastAccount,
  withLastAccount,
} from "./lastAccount";
import { publishSessionToken } from "./publish_session_token";
import { useClerkSession } from "./session";

type AccountOption = {
  id: string;
  name: string;
  clerkOrganizationId: string | null;
};

type AccountSwitcherState = {
  active: AccountOption;
  options: AccountOption[];
  creating: boolean;
  name: string;
  setName: (name: string) => void;
  setCreating: (creating: boolean) => void;
  selectAccount: (accountId: string) => Promise<void>;
  create: () => Promise<boolean>;
};

const AccountSwitcherContext = createContext<AccountSwitcherState | null>(null);

function useAccountSwitcherState(): AccountSwitcherState | null {
  return useContext(AccountSwitcherContext);
}

export function AccountSwitcherProvider({ children }: { children: ReactNode }) {
  const session = useClerkSession();
  // Refreshing the session token after an account change reports "loading".
  // Unmounting here would drop the click and restore the previous organization.
  const keepSwitcher = useRef(false);
  if (session.status === "signed-in") keepSwitcher.current = true;
  if (
    session.status === "signed-out" ||
    session.status === "unconfigured" ||
    session.status === "unavailable"
  ) {
    keepSwitcher.current = false;
  }
  if (!keepSwitcher.current) {
    return (
      <AccountSwitcherContext.Provider value={null}>
        {children}
      </AccountSwitcherContext.Provider>
    );
  }
  return <SignedInAccountSwitcher>{children}</SignedInAccountSwitcher>;
}

function SignedInAccountSwitcher({ children }: { children: ReactNode }) {
  const session = useClerkSession();
  const { getToken } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();
  const { isLoaded, setActive, createOrganization, userMemberships } =
    useOrganizationList({
      // Clerk returns 10 memberships per page. A larger page size makes the
      // next offset skip the organizations that did not fit on the first page.
      userMemberships: { infinite: true, pageSize: 10 },
    });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const store = useStore();
  const context = useQuery({
    queryKey: queryKeys.account.context,
    queryFn: () => ipc.account.getContext(),
    retry: false,
    enabled: session.status === "signed-in",
  });
  const restored = useRef(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createdAccounts, setCreatedAccounts] = useState<AccountOption[]>([]);
  const memberships = userMemberships.data;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (
      !userMemberships.hasNextPage ||
      userMemberships.isFetching ||
      !userMemberships.fetchNext
    ) {
      return;
    }
    userMemberships.fetchNext();
  }, [
    userMemberships.hasNextPage,
    userMemberships.isFetching,
    userMemberships.fetchNext,
  ]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });

  const storeSessionToken = () =>
    publishSessionToken(async () => {
      const token = await getToken({ skipCache: true });
      return token || undefined;
    });

  const leaveOpenApp = () => {
    if (store.get(selectedAppIdAtom) == null) return;
    store.set(selectedAppIdAtom, null);
    store.set(selectedChatIdAtom, null);
    void navigate({ to: "/" });
  };

  const remember = async (organizationId: string | null) => {
    if (!user) return;
    const current = user.unsafeMetadata;
    await user.update({
      unsafeMetadata: withLastAccount(
        current && typeof current === "object" ? { ...current } : undefined,
        organizationId,
      ),
    });
  };

  useEffect(() => {
    if (session.status !== "signed-in" || !setActive || !user) return;
    const message = context.error instanceof Error ? context.error.message : "";
    if (!message.includes("no longer a member")) return;
    void (async () => {
      await setActive({ organization: null });
      await remember(null);
      await storeSessionToken();
      leaveOpenApp();
      await refresh();
    })();
  }, [context.error, session.status, setActive, user]);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    if (!isLoaded || !setActive || !user || userMemberships.isLoading) return;
    if (userMemberships.hasNextPage || userMemberships.isFetching) return;
    if (!memberships || restored.current || context.isError) return;
    const decision = restoreLastAccount({
      saved: readLastAccount(user.unsafeMetadata),
      activeOrganizationId: organization?.id ?? null,
      membershipOrganizationIds: memberships.map(
        (membership) => membership.organization.id,
      ),
    });
    restored.current = true;
    if (decision.kind === "keep") return;
    void (async () => {
      await setActive({
        organization: decision.kind === "private" ? null : decision.id,
      });
      await storeSessionToken();
      await refresh();
    })();
  }, [
    session.status,
    isLoaded,
    setActive,
    user,
    userMemberships.isLoading,
    userMemberships.hasNextPage,
    userMemberships.isFetching,
    organization?.id,
    memberships,
    context.isError,
  ]);

  const selectAccount = async (accountId: string) => {
    if (!setActive || !userId) return;
    const displayedId = organization?.id ?? userId;
    if (accountId === displayedId) return;
    const organizationId = accountId === userId ? null : accountId;
    const previousOrganizationId = organization?.id ?? null;
    try {
      // Save first. A token refresh remounts this tree, and restore would
      // otherwise put the previous organization back.
      await remember(organizationId);
      await setActive({ organization: organizationId });
      const token = await getToken({ skipCache: true });
      if (!token) {
        throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
      }
      const stored = await publishSessionToken(async () => token);
      if (!stored) {
        throw new DyadError("Sign in to continue.", DyadErrorKind.Auth);
      }
      leaveOpenApp();
      await refresh();
    } catch (error) {
      try {
        await setActive({ organization: previousOrganizationId });
        await remember(previousOrganizationId);
      } catch {
        // The label still follows Clerk.
      }
      showError(error);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !createOrganization || !setActive) return false;
    try {
      const created = await createOrganization({ name: trimmed });
      setCreatedAccounts((current) =>
        current.some((account) => account.id === created.id)
          ? current
          : [
              ...current,
              {
                id: created.id,
                name: trimmed,
                clerkOrganizationId: created.id,
              },
            ],
      );
      try {
        await ipc.clerk.stampOrganizationAdmin({ organizationId: created.id });
      } catch (error) {
        showError(error);
      }
      await userMemberships.revalidate?.();
      await remember(created.id);
      await setActive({ organization: created.id });
      await storeSessionToken();
      leaveOpenApp();
      setName("");
      setCreating(false);
      await refresh();
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };

  const activeId = organization?.id ?? userId;
  const ready =
    isLoaded &&
    (session.status === "signed-in" || session.status === "loading");
  const listedIds = new Set(
    (memberships ?? []).map((membership) => membership.organization.id),
  );
  const options: AccountOption[] = [
    ...(userId
      ? [{ id: userId, name: "Private", clerkOrganizationId: null }]
      : []),
    ...createdAccounts.filter((account) => !listedIds.has(account.id)),
    ...(memberships ?? []).map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      clerkOrganizationId: membership.organization.id,
    })),
  ];
  const activeName = organization ? organization.name : userId ? "Private" : "";
  const value: AccountSwitcherState | null =
    ready && activeId
      ? {
          active: {
            id: activeId,
            name: activeName,
            clerkOrganizationId: organization?.id ?? null,
          },
          options,
          creating,
          name,
          setName,
          setCreating,
          selectAccount,
          create,
        }
      : null;

  return (
    <AccountSwitcherContext.Provider value={value}>
      {children}
    </AccountSwitcherContext.Provider>
  );
}

export function OrganizationPicker() {
  const state = useAccountSwitcherState();
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const current = state.active.id;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) state.setCreating(false);
      }}
    >
      <DropdownMenuTrigger
        className="no-app-region-drag ml-1.5 inline-flex h-7 max-w-[10rem] items-center gap-1.5 rounded-md border bg-transparent px-2 text-xs font-medium"
        aria-label="Account"
        data-testid="organization-picker"
      >
        <OrganizationMark
          name={state.active.name}
          accountId={state.active.clerkOrganizationId}
        />
        <span className="truncate">{state.active.name}</span>
      </DropdownMenuTrigger>
      {open ? (
        <DropdownMenuPortal>
          <button
            type="button"
            aria-label="Close account menu"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
            onClick={() => setOpen(false)}
          />
        </DropdownMenuPortal>
      ) : null}
      <DropdownMenuContent data-testid="organization-picker-menu">
        {state.creating ? (
          <form
            className="flex items-center gap-1 px-2 py-1.5"
            data-testid="create-organization-form"
            onSubmit={(event) => {
              event.preventDefault();
              void state.create().then((created) => {
                if (created) setOpen(false);
              });
            }}
          >
            <input
              aria-label="Organization name"
              autoFocus
              className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm"
              value={state.name}
              onChange={(event) => state.setName(event.target.value)}
            />
            <button type="submit" className="shrink-0 text-sm text-primary">
              Create
            </button>
          </form>
        ) : (
          <DropdownMenuItem
            closeOnClick={false}
            data-testid="create-organization"
            onClick={() => state.setCreating(true)}
          >
            Create organization
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            void state.selectAccount(value);
          }}
        >
          {state.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              closeOnClick
            >
              <OrganizationMark
                name={option.name}
                accountId={option.clerkOrganizationId}
              />
              <span className="truncate">{option.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
