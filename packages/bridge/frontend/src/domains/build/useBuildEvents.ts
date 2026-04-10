/**
 * useBuildEvents — real-time WebSocket event subscription for a specific build.
 *
 * Subscribes to bridge events on the 'build' domain via useBridgeEvents,
 * filters for the selected buildId, and converts incoming events into
 * ConversationMessage objects that the ConversationPanel can render.
 *
 * Supported event types:
 *   - build.agent_message  → agent message in conversation
 *   - build.gate_waiting   → system message + gate type for action buttons
 *   - build.gate_resolved  → system message indicating gate resolution
 *   - build.phase_started  → system message for phase transition
 *   - build.phase_completed → system message for phase completion
 *
 * @see PRD 047 §Dashboard Architecture — Conversation Panel (Feature 2)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBridgeEvents } from '@/shared/websocket/useBridgeEvents';
import { api } from '@/shared/lib/api';
import type { BridgeEvent } from '@/shared/stores/event-store';
import type { ConversationMessage, GateType, Phase } from './types';

interface BuildLiveState {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  currentPhase: Phase | null;
  costUsd: number;
  costTokens: number;
  completedPhases: Phase[];
  humanInterventions: number;
  artifacts?: Record<string, string>;
}

// ── Event → Message conversion ─────────────────────────────────

/** Formats an ISO timestamp to HH:MM:SS for display consistency with mock data. */
function formatTimestamp(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    if (isNaN(d.getTime())) return isoTimestamp;
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoTimestamp;
  }
}

/** Safely coerce a payload value to a string — stringify objects instead of lying with `as string`. */
function toStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Convert a BridgeEvent into a ConversationMessage (or null if not mappable). */
function eventToMessage(event: BridgeEvent): ConversationMessage | null {
  const timestamp = formatTimestamp(event.timestamp);
  const payload = event.payload ?? {};

  switch (event.type) {
    case 'build.agent_message':
      return {
        id: `ws-${event.id}`,
        sender: (payload.sender as 'agent' | 'human' | 'system' | undefined) ?? 'agent',
        content: toStr(payload.content) || toStr(payload.message),
        timestamp,
        replyTo: (payload.replyTo as string) ?? undefined,
        card: payload.card as ConversationMessage['card'],
      };

    case 'build.system_message':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: toStr(payload.content),
        timestamp,
      };

    case 'build.gate_waiting':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Gate waiting: ${(payload.gate as string) ?? (payload.detail as string) ?? event.type} — awaiting human input`,
        timestamp,
      };

    case 'build.gate_resolved':
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Gate resolved: ${(payload.gate as string) ?? (payload.detail as string) ?? 'gate passed'}`,
        timestamp,
      };

    case 'build.phase_started': {
      const phase = (payload.phase as string) ?? (payload.target as string) ?? 'unknown';
      const detail = (payload.detail as string) ?? '';
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: detail ? `Phase started: ${phase} — ${detail}` : `Phase started: ${phase}`,
        timestamp,
      };
    }

    case 'build.phase_completed': {
      const phase = (payload.phase as string) ?? (payload.target as string) ?? 'unknown';
      const cost = payload.cost as { usd?: number } | undefined;
      const durationMs = payload.durationMs as number | undefined;
      const parts: string[] = [];
      if (durationMs) parts.push(`${(durationMs / 1000).toFixed(1)}s`);
      if (cost?.usd) parts.push(`$${cost.usd.toFixed(3)}`);
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      return {
        id: `ws-${event.id}`,
        sender: 'system',
        content: `Phase completed: ${phase}${suffix}`,
        timestamp,
      };
    }

    default:
      return null;
  }
}

// ── Hook result ────────────────────────────────────────────────

export interface UseBuildEventsResult {
  /** Live conversation messages converted from WebSocket events. */
  messages: ConversationMessage[];
  /** Active gate type from the most recent gate_waiting event (cleared on gate_resolved). */
  liveGate: GateType | null;
  /** Current phase from the most recent phase_started event. */
  currentPhase: Phase | null;
  /** Whether a phase is currently in flight (started but not completed). */
  phaseActive: boolean;
  /** Build status derived from events (running/completed/failed/aborted). */
  liveStatus: 'running' | 'completed' | 'failed' | 'aborted' | null;
  /** Accumulated cost in USD from all completed phases. */
  liveCost: number;
  /** Phases that have completed (for pipeline progress display). */
  completedPhases: Set<Phase>;
  /** Artifact manifest (artifact_id → content) from the orchestrator. */
  liveArtifacts: Record<string, string>;
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * Subscribe to real-time build events and produce conversation messages.
 * Uses useBridgeEvents internally for the WebSocket subscription.
 *
 * @param buildId — the build to filter events for (null disables subscription)
 */
export function useBuildEvents(buildId: string | null): UseBuildEventsResult {
  // Subscribe to all build-domain events via useBridgeEvents (PRD 026)
  const events = useBridgeEvents({ domain: 'build' });

  // Fetch initial live state from backend (for restoring state after page reload)
  const { data: initialState } = useQuery({
    queryKey: ['build-state', buildId],
    queryFn: async ({ signal }) => {
      if (!buildId) return null;
      return api.get<BuildLiveState>(`/api/builds/${buildId}/state`, signal);
    },
    enabled: !!buildId,
    retry: 1,
    refetchInterval: 10_000,
  });

  // Filter events for the selected build and convert to messages
  const result = useMemo(() => {
    const empty = {
      messages: [] as ConversationMessage[],
      liveGate: null as GateType | null,
      currentPhase: null as Phase | null,
      phaseActive: false,
      liveStatus: null as 'running' | 'completed' | 'failed' | 'aborted' | null,
      liveCost: 0,
      completedPhases: new Set<Phase>(),
      liveArtifacts: {} as Record<string, string>,
    };
    if (!buildId) return empty;

    // Seed from backend state (restores after reload) — events override these
    const msgs: ConversationMessage[] = [];
    let gate: GateType | null = null;
    let phase: Phase | null = initialState?.currentPhase ?? null;
    let phaseActive = initialState?.status === 'running' && !!initialState?.currentPhase;
    let status: 'running' | 'completed' | 'failed' | 'aborted' | null = initialState?.status ?? null;
    let cost = initialState?.costUsd ?? 0;
    const completedPhases = new Set<Phase>(initialState?.completedPhases ?? []);

    for (const event of events) {
      // Filter: match against sessionId (primary) OR payload.buildId (fallback)
      const eventBuildId =
        (event.sessionId as string | undefined) ??
        (event.payload?.buildId as string | undefined) ??
        (event.correlationId as string | undefined);

      if (eventBuildId !== buildId) continue;

      // Track gate state
      if (event.type === 'build.gate_waiting') {
        gate = ((event.payload?.gate as string) ?? null) as GateType | null;
      } else if (event.type === 'build.gate_resolved') {
        gate = null;
      }

      // Track phase state
      if (event.type === 'build.phase_started') {
        phase = (event.payload?.phase as Phase) ?? phase;
        phaseActive = true;
      } else if (event.type === 'build.phase_completed') {
        const completedPhase: Phase | null = (event.payload?.phase as Phase) ?? phase;
        phase = completedPhase;
        phaseActive = false;
        if (completedPhase) completedPhases.add(completedPhase);
      }

      // Track cost
      if (event.type === 'build.cost_updated') {
        cost = (event.payload?.totalUsd as number) ?? cost;
      }

      // Track build status
      if (event.type === 'build.started') {
        status = 'running';
      } else if (event.type === 'build.completed') {
        status = 'completed';
      } else if (event.type === 'build.failure_detected') {
        status = 'failed';
      } else if (event.type === 'build.aborted') {
        status = 'aborted';
      }

      // Convert to message
      const msg = eventToMessage(event);
      if (msg) {
        msgs.push(msg);
      }
    }

    return {
      messages: msgs,
      liveGate: gate,
      currentPhase: phase,
      phaseActive,
      liveStatus: status,
      liveCost: cost,
      completedPhases,
      liveArtifacts: initialState?.artifacts ?? {},
    };
  }, [buildId, events, initialState]);

  return result;
}
