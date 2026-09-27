import {
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { OrganizationMark } from "./OrganizationMark";
import {
  readLastAccount,
  restoreLastAccount,
  withLastAccount,
} from "./lastAccount";
import { useClerkSession } from "./session";

type AccountOption = { id: string | null; name: string };

type AccountSwitcherState = {
  active: AccountOption;
  options: AccountOption[];
  creating: boolean;
  name: string;
  setName: (name: string) => void;
  setCreating: (creating: boolean) => void;
  selectAccount: (organizationId: string | null) => Promise<void>;
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
  const { user } = useUser();
  const { organization } = useOrganization();
  const { isLoaded, setActive, createOrganization, userMemberships } =
    useOrganizationList({
      // Clerk returns 10 memberships per page. A larger page size makes the
      // next offset skip the organizations that did not fit on the first page.
      userMemberships: { infinite: true, pageSize: 10 },
    });
  const queryClient = useQueryClient();
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
  // null is Private. undefined means the label follows Clerk's active organization.
  const [pendingAccountId, setPendingAccountId] = useState<
    string | null | undefined
  >(undefined);
  const memberships = userMemberships.data;

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
    void setActive({ organization: null }).then(() => remember(null));
  }, [context.error, session.status, setActive, user]);

  useEffect(() => {
    if (session.status !== "signed-in") return;
    if (!isLoaded || !setActive || !user || userMemberships.isLoading) return;
    if (userMemberships.hasNextPage || userMemberships.isFetching) return;
    if (pendingAccountId !== undefined) return;
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
    void setActive({
      organization: decision.kind === "private" ? null : decision.id,
    }).then(() => refresh());
  }, [
    session.status,
    isLoaded,
    setActive,
    user,
    userMemberships.isLoading,
    userMemberships.hasNextPage,
    userMemberships.isFetching,
    pendingAccountId,
    organization?.id,
    memberships,
    context.isError,
  ]);

  const selectAccount = async (organizationId: string | null) => {
    if (!setActive) return;
    const previous = organization?.id ?? null;
    setPendingAccountId(organizationId);
    try {
      // Save first. The token refresh remounts this tree, and restore would
      // otherwise put the previous organization back before Private sticks.
      await remember(organizationId);
      await setActive({ organization: organizationId });
      await refresh();
    } catch (error) {
      setPendingAccountId(previous);
      try {
        await remember(previous);
      } catch {
        // The label is already back on the previous account.
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
          : [...current, { id: created.id, name: trimmed }],
      );
      setPendingAccountId(created.id);
      try {
        await ipc.clerk.stampOrganizationAdmin({ organizationId: created.id });
      } catch (error) {
        showError(error);
      }
      await userMemberships.revalidate?.();
      await remember(created.id);
      await setActive({ organization: created.id });
      setName("");
      setCreating(false);
      await refresh();
      return true;
    } catch (error) {
      setPendingAccountId(undefined);
      showError(error);
      return false;
    }
  };

  const clerkActiveId = organization?.id ?? null;
  const activeId =
    pendingAccountId !== undefined ? pendingAccountId : clerkActiveId;
  const ready =
    isLoaded &&
    (session.status === "signed-in" || session.status === "loading");
  const listedIds = new Set(
    (memberships ?? []).map((membership) => membership.organization.id),
  );
  const options: AccountOption[] = [
    { id: null, name: "Private" },
    ...createdAccounts.filter(
      (account) => account.id && !listedIds.has(account.id),
    ),
    ...(memberships ?? []).map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
    })),
  ];
  const activeName =
    activeId == null
      ? "Private"
      : (options.find((option) => option.id === activeId)?.name ??
        (organization?.id === activeId ? organization.name : null) ??
        "Private");
  const value: AccountSwitcherState | null = ready
    ? {
        active: {
          id: activeId,
          name: activeName,
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
  const current = state.active.id ?? "private";
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
          accountId={state.active.id}
        />
        <span className="truncate">{state.active.name}</span>
      </DropdownMenuTrigger>
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
            void state.selectAccount(value === "private" ? null : value);
          }}
        >
          {state.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id ?? "private"}
              value={option.id ?? "private"}
            >
              <OrganizationMark name={option.name} accountId={option.id} />
              <span className="truncate">{option.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
