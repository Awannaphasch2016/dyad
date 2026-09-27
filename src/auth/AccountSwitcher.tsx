import { useOrganization, useOrganizationList } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { useClerkSession } from "./session";

export function AccountSwitcher() {
  const session = useClerkSession();
  if (session.status !== "signed-in") return null;
  return <AccountSwitcherMenu />;
}

function AccountSwitcherMenu() {
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
  useEffect(() => {
    if (!setActive) return;
    const message = context.error instanceof Error ? context.error.message : "";
    if (message.includes("no longer a member")) {
      void setActive({ organization: null });
    }
  }, [context.error, setActive]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const memberships = userMemberships.data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });

  const selectAccount = async (organizationId: string | null) => {
    if (!setActive) return;
    try {
      await setActive({ organization: organizationId });
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
        {memberships.map((membership) => (
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
