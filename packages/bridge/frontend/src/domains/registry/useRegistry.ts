/**
 * PRD 019.2: TanStack Query hooks for registry API endpoints.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import type { RegistryTree, ManifestResponse, MethodDetail, PromotionRecord } from '@/lib/registry-types';

/** Fetch the full registry tree */
export function useRegistryTree() {
  return useQuery<RegistryTree>({
    queryKey: ['registry', 'tree'],
    queryFn: ({ signal }) => api.get<RegistryTree>('/api/registry', signal),
    staleTime: 60_000, // 1 minute (matches server cache TTL)
  });
}

/** Fetch a specific method/protocol detail */
export function useMethodDetail(methodologyId: string | null, methodId: string | null) {
  return useQuery<MethodDetail>({
    queryKey: ['registry', 'method', methodologyId, methodId],
    queryFn: ({ signal }) =>
      api.get<MethodDetail>(`/api/registry/${methodologyId}/${methodId}`, signal),
    enabled: !!methodologyId && !!methodId,
    staleTime: 60_000,
  });
}

/** Fetch a protocol's promotion record (if one exists) */
export function usePromotionRecord(methodologyId: string | null, protocolId: string | null) {
  return useQuery<PromotionRecord>({
    queryKey: ['registry', 'promotion', methodologyId, protocolId],
    queryFn: ({ signal }) =>
      api.get<PromotionRecord>(`/api/registry/${methodologyId}/${protocolId}/promotion`, signal),
    enabled: !!methodologyId && !!protocolId,
    staleTime: 60_000,
    retry: false, // 404 is expected for protocols without promotion records
  });
}

/** Fetch the manifest with sync status */
export function useRegistryManifest() {
  return useQuery<ManifestResponse>({
    queryKey: ['registry', 'manifest'],
    queryFn: ({ signal }) => api.get<ManifestResponse>('/api/registry/manifest', signal),
    staleTime: 60_000,
  });
}

/** Invalidate the server-side registry cache and refetch */
export function useRegistryReload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ status: string; message: string }>('/api/registry/reload'),
    onSuccess: () => {
      // Invalidate all registry queries so they refetch
      queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });
}
