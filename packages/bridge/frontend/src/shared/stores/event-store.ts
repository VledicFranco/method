/**
 * Unified event store — PRD 026 Phase 4.
 *
 * Replaces ws-store.ts as the single source of truth for bridge events.
 * Stores BridgeEvent objects (the universal schema) and provides
 * connection state tracking. All domain-specific hooks (useBridgeEvents,
 * useEventStream) read from this store.
 */

import { create } from 'zustand';

// ── Frontend BridgeEvent type (mirrors backend ports/event-bus.ts) ──

export type EventDomain =
  | 'session'
  | 'strategy'
  | 'trigger'
  | 'project'
  | 'methodology'
  | 'system'
  | (string & {});

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface BridgeEvent {
  id: string;
  version: 1;
  timestamp: string;
  sequence: number;
  domain: EventDomain;
  type: string;
  severity: EventSeverity;
  projectId?: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  source: string;
  correlationId?: string;
}

export interface BridgeEventFilter {
  domain?: EventDomain;
  type?: string;
  projectId?: string;
  sessionId?: string;
  severity?: EventSeverity | EventSeverity[];
}

// ── Store ───────────────────────────────────────────────────────

/** Maximum events retained in the store (prevents unbounded memory growth). */
const MAX_EVENTS = 5000;

interface EventStoreState {
  /** Whether the WebSocket connection is currently open. */
  connected: boolean;
  /** All received bridge events (capped at MAX_EVENTS, newest last). */
  events: BridgeEvent[];

  setConnected: (connected: boolean) => void;
  addEvent: (event: BridgeEvent) => void;
  addEvents: (events: BridgeEvent[]) => void;
  clearEvents: () => void;
}

export const useEventStore = create<EventStoreState>((set) => ({
  connected: false,
  events: [],

  setConnected: (connected) => set({ connected }),

  addEvent: (event) =>
    set((state) => {
      const next = [...state.events, event];
      return { events: next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next };
    }),

  addEvents: (newEvents) =>
    set((state) => {
      if (newEvents.length === 0) return state;
      const next = [...state.events, ...newEvents];
      return { events: next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next };
    }),

  clearEvents: () => set({ events: [] }),
}));
