/**
 * useTranscript — React Query hook for fetching a session's historical transcript.
 *
 * Fetches from GET /api/transcript/:id and maps turns to ChatTurn[] via pairTurns.
 * staleTime is set to Infinity because JSONL transcripts are append-only — once
 * fetched, they are not re-fetched in the background. The caller invalidates
 * manually when a session ends.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { pairTurns } from './pairTurns';
import type { ApiTranscriptTurn } from './pairTurns';
import type { ChatTurn } from './types';

// ── API response shape ───────────────────────────────────────────────────────
// Matches GET /api/transcript/:id → { session_id, turns, count }

interface TranscriptResponse {
  session_id: string;
  turns: ApiTranscriptTurn[];
  count: number;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTranscript(sessionId: string | null): {
  data: ChatTurn[] | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['transcript', sessionId],
    queryFn: ({ signal }) =>
      api.get<TranscriptResponse>(`/api/transcript/${sessionId}`, signal),
    enabled: sessionId != null,
    staleTime: Infinity,
    select: (response) => pairTurns(response.turns),
  });
}
