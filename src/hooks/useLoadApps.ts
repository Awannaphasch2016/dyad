import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClerkSession } from "@/auth/session";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useLoadApps() {
  const queryClient = useQueryClient();
  const session = useClerkSession();
  const accountId =
    session.status === "signed-in"
      ? `${session.account?.type ?? "user"}:${session.account?.id ?? session.userId}`
      : null;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.apps.list(accountId),
    queryFn: async () => {
      const appListResponse = await ipc.app.listApps();
      return appListResponse.apps;
    },
  });

  const refreshApps = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.appCollections.all });
    return queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
  };

  return {
    apps: data ?? [],
    loading: isLoading,
    error: error ?? null,
    refreshApps,
  };
}
