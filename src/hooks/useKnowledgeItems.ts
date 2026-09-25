import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";

export function useKnowledgeItems(appId: number | null) {
  const queryClient = useQueryClient();

  const items = useQuery({
    queryKey: queryKeys.knowledge.list({ appId }),
    queryFn: () => ipc.knowledge.list({ appId: appId! }),
    enabled: appId != null,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.knowledge.list({ appId }),
    });

  const create = useMutation({
    mutationFn: (params: { title: string; url: string; addedBy?: string }) =>
      ipc.knowledge.create({ appId: appId!, ...params }),
    onSuccess: () => void invalidate(),
    onError: (error) => showError(error),
  });

  const remove = useMutation({
    mutationFn: (id: number) => ipc.knowledge.delete({ id, appId: appId! }),
    onSuccess: () => void invalidate(),
    onError: (error) => showError(error),
  });

  return {
    items: items.data ?? [],
    isLoading: items.isLoading,
    error: items.error ?? null,
    refetch: items.refetch,
    createItem: (params: { title: string; url: string; addedBy?: string }) =>
      create.mutateAsync(params),
    isCreating: create.isPending,
    deleteItem: (id: number) => remove.mutateAsync(id),
    isDeleting: remove.isPending,
  };
}
