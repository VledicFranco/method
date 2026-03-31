/**
 * SessionPool Port — Cross-domain interface for session pool access.
 *
 * Domains that need session lifecycle operations (genesis, methodology,
 * strategies) depend on this port instead of importing the concrete
 * SessionPool directly from domains/sessions/pool.ts.
 *
 * The composition root (server-entry.ts) wires the real pool implementation
 * to consumers. This satisfies FCA G-BOUNDARY: no cross-domain imports.
 *
 * Re-exports the SessionPool interface and associated types from the sessions
 * domain. The port file is the sanctioned import path for cross-domain use.
 */

// ── Port interface + associated types ──────────────────────────

export type {
  SessionPool,
  SessionStatusInfo,
  SessionBudget,
  SessionChainInfo,
  WorktreeInfo,
  SessionMode,
  IsolationMode,
  WorktreeAction,
  StreamEvent,
} from '../domains/sessions/pool.js';
