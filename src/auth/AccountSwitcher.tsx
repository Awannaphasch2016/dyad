import {
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import {
  readLastAccount,
  restoreLastAccount,
  withLastAccount,
} from "./lastAccount";
import { useClerkSession } from "./session";

export function AccountSwitcher() {
  const session = useClerkSession();
  if (session.status !== "signed-in") return null;
  return <AccountSwitcherMenu />;
}

function AccountSwitcherMenu() {
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
    if (!setActive || !user) return;
    const message = context.error instanceof Error ? context.error.message : "";
    if (!message.includes("no longer a member")) return;
    void setActive({ organization: null }).then(() => remember(null));
  }, [context.error, setActive, user]);

  useEffect(() => {
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

  if (!isLoaded) return null;

  return (
    <div
      className="no-app-region-drag mr-3 flex shrink-0 items-center gap-2"
      data-testid="account-switcher"
    >
      <select
        aria-label="Account"
        className="h-8 max-w-[10rem] rounded-md border bg-transparent px-2 text-sm"
        value={organization?.id ?? "private"}
        onChange={(event) => {
          const value = event.target.value;
          void selectAccount(value === "private" ? null : value);
        }}
      >
        <option value="private">Private</option>
        {(memberships ?? []).map((membership) => (
          <option
            key={membership.organization.id}
            value={membership.organization.id}
          >
            {membership.organization.name}
          </option>
        ))}
      </select>
      {creating ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            aria-label="Organization name"
            className="h-8 w-32 rounded-md border bg-transparent px-2 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="text-sm text-primary">
            Create
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="text-sm text-primary"
          onClick={() => setCreating(true)}
        >
          Create organization
        </button>
      )}
    </div>
  );
}
