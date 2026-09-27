import { useOrganizationList } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { useClerkSession } from "@/auth/session";

export function AccountAppActions({ appId }: { appId: number }) {
  const session = useClerkSession();
  if (session.status !== "signed-in" || !session.account) return null;
  return <AccountAppActionsMenu appId={appId} />;
}

function AccountAppActionsMenu({ appId }: { appId: number }) {
  const session = useClerkSession();
  const { userMemberships } = useOrganizationList({
    userMemberships: { infinite: true, pageSize: 20 },
  });
  const queryClient = useQueryClient();
  if (session.status !== "signed-in" || !session.account) return null;
  const account = session.account;
  const memberships = userMemberships.data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });

  const moveTo = async (ownerType: "user" | "org", ownerId: string) => {
    try {
      await ipc.account.moveApp({ appId, ownerType, ownerId });
      await refresh();
    } catch (error) {
      showError(error);
    }
  };

  const copyToPrivate = async () => {
    try {
      await ipc.account.copyApp({
        appId,
        ownerType: "user",
        ownerId: session.userId,
      });
      await refresh();
    } catch (error) {
      showError(error);
    }
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="account-app-actions">
      {account.type === "user" &&
        memberships.map((membership) => (
          <Button
            key={membership.organization.id}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void moveTo("org", membership.organization.id)}
          >
            Move to {membership.organization.name}
          </Button>
        ))}
      {account.type === "org" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void copyToPrivate()}
        >
          Copy to private
        </Button>
      )}
    </div>
  );
}
