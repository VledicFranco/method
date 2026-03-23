import { create } from 'zustand';
import type { ProjectEvent } from '@/lib/types';

interface WsState {
  /** Whether the WebSocket connection is currently open */
  connected: boolean;
  /** Accumulated project events (append-only) */
  events: ProjectEvent[];

  setConnected: (connected: boolean) => void;
  appendEvents: (newEvents: ProjectEvent[]) => void;
  clearEvents: () => void;
}

export const useWsStore = create<WsState>((set) => ({
  connected: false,
  events: [],

  setConnected: (connected) => set({ connected }),

  appendEvents: (newEvents) =>
    set((state) => ({
      events: [...state.events, ...newEvents],
    })),

  clearEvents: () => set({ events: [] }),
}));
