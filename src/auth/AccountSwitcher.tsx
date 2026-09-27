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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  create: () => Promise<void>;
};

const AccountSwitcherContext = createContext<AccountSwitcherState | null>(null);

function useAccountSwitcherState(): AccountSwitcherState | null {
  return useContext(AccountSwitcherContext);
}

export function AccountSwitcherProvider({ children }: { children: ReactNode }) {
  const session = useClerkSession();
  if (session.status !== "signed-in") {
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
      userMemberships: { infinite: true, pageSize: 20 },
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
  const memberships = userMemberships.data;

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
    organization?.id,
    memberships,
    context.isError,
  ]);

  const selectAccount = async (organizationId: string | null) => {
    if (!setActive) return;
    try {
      await setActive({ organization: organizationId });
      await remember(organizationId);
      await refresh();
    } catch (error) {
      showError(error);
    }
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !createOrganization || !setActive) return;
    try {
      const created = await createOrganization({ name: trimmed });
      await ipc.clerk.stampOrganizationAdmin({ organizationId: created.id });
      await setActive({ organization: created.id });
      await remember(created.id);
      setName("");
      setCreating(false);
      await refresh();
    } catch (error) {
      showError(error);
    }
  };

  const ready = session.status === "signed-in" && isLoaded;
  const options: AccountOption[] = [
    { id: null, name: "Private" },
    ...(memberships ?? []).map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
    })),
  ];
  const value: AccountSwitcherState | null = ready
    ? {
        active: {
          id: organization?.id ?? null,
          name: organization?.name ?? "Private",
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
  if (!state) return null;
  const current = state.active.id ?? "private";
  return (
    <DropdownMenu>
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

export function CreateOrganizationButton() {
  const state = useAccountSwitcherState();
  if (!state) return null;
  if (state.creating) {
    return (
      <form
        className="no-app-region-drag mr-3 flex shrink-0 items-center gap-1"
        data-testid="create-organization-form"
        onSubmit={(event) => {
          event.preventDefault();
          void state.create();
        }}
      >
        <input
          aria-label="Organization name"
          className="h-8 w-32 rounded-md border bg-transparent px-2 text-sm"
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
        />
        <button type="submit" className="text-sm text-primary">
          Create
        </button>
      </form>
    );
  }
  return (
    <button
      type="button"
      className="no-app-region-drag mr-3 shrink-0 text-sm text-primary"
      data-testid="create-organization"
      onClick={() => state.setCreating(true)}
    >
      Create organization
    </button>
  );
}
