/**
 * Genesis state store — PRD 025 Phase 1.
 *
 * Extracts all Genesis state from Dashboard.tsx into a shared Zustand store
 * so Genesis FAB + ChatPanel can render universally across all pages.
 * Chat open/closed state persists to localStorage. Messages live in memory.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Types ──────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export type GenesisAction =
  | { type: 'navigate'; path: string }
  | { type: 'highlight'; selector: string; duration?: number }
  | { type: 'openPanel'; panel: string; id: string }
  | { type: 'closePanel' }
  | { type: 'toast'; message: string; severity: 'info' | 'warning' | 'error' }
  | { type: 'spawnSession'; projectId: string; prompt?: string }
  | { type: 'focusProject'; projectId: string };

/** Re-export-safe subset of ProjectMetadata used by Genesis store. */
export interface GenesisProjectMetadata {
  id: string;
  name: string;
  description?: string;
  path: string;
  status: string;
}

// ── Store interface ────────────────────────────────────────────

interface GenesisState {
  // Chat state (persists across navigation)
  isOpen: boolean;
  messages: ChatMessage[];
  inputDraft: string;

  // Agent state
  sessionId: string | null;
  status: 'active' | 'idle' | 'disconnected';
  budgetPercent: number;

  // Page awareness (written by pages on mount) — Phase 2
  currentPage: {
    route: string;
    domain: string;
    context: Record<string, unknown>;
  };
  selectedProject: GenesisProjectMetadata | null;

  // UI control (written by Genesis, read by pages) — Phase 4
  pendingAction: GenesisAction | null;

  // Actions
  setOpen: (open: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  setInputDraft: (draft: string) => void;
  setStatus: (status: GenesisState['status']) => void;
  setBudgetPercent: (percent: number) => void;
  setSessionId: (id: string | null) => void;
  setPageContext: (route: string, domain: string, context: Record<string, unknown>) => void;
  setSelectedProject: (project: GenesisProjectMetadata | null) => void;
  dispatchAction: (action: GenesisAction) => void;
  consumeAction: () => GenesisAction | null;
}

// ── Default session ID ─────────────────────────────────────────

export const GENESIS_SESSION_ID = 'genesis-root';

// ── Store ──────────────────────────────────────────────────────

/** Maximum chat messages retained in memory (prevents unbounded growth). */
const MAX_MESSAGES = 10000;

export const useGenesisStore = create<GenesisState>()(
  persist(
    (set, get) => ({
      // Chat state
      isOpen: false,
      messages: [],
      inputDraft: '',

      // Agent state
      sessionId: GENESIS_SESSION_ID,
      status: 'idle',
      budgetPercent: 0,

      // Page awareness
      currentPage: { route: '/', domain: 'dashboard', context: {} },
      selectedProject: null,

      // UI control
      pendingAction: null,

      // Actions
      setOpen: (open) => set({ isOpen: open }),

      addMessage: (msg) =>
        set((state) => {
          const next = [...state.messages, msg];
          return { messages: next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next };
        }),

      setInputDraft: (draft) => set({ inputDraft: draft }),

      setStatus: (status) => set({ status }),

      setBudgetPercent: (percent) => set({ budgetPercent: Math.min(percent, 100) }),

      setSessionId: (id) => set({ sessionId: id }),

      setPageContext: (route, domain, context) =>
        set({ currentPage: { route, domain, context } }),

      setSelectedProject: (project) => set({ selectedProject: project }),

      dispatchAction: (action) => set({ pendingAction: action }),

      consumeAction: () => {
        const action = get().pendingAction;
        if (action) set({ pendingAction: null });
        return action;
      },
    }),
    {
      name: 'method-genesis',
      // Only persist UI state — not transient agent data or messages
      partialize: (state) => ({
        isOpen: state.isOpen,
      }),
    },
  ),
);
