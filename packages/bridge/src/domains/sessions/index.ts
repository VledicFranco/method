/**
 * Sessions domain barrel — bridge-side.
 *
 * PRD-057 / S2 §3.3 / C5: the session pool, providers, channels,
 * diagnostics, scope-hook, cognitive sink, and supporting runtime
 * machinery moved to `@method/runtime/sessions`. Bridge keeps only
 * Fastify routes + Node-specific persistence / transcript / worktree
 * helpers.
 *
 * For external consumers, import engine surface directly from
 * `@method/runtime/sessions` rather than through this barrel.
 */

// Runtime re-exports (compat): bridge-internal code historically imported
// these names from `./domains/sessions/index.js` — the barrel forwards
// to the runtime subpath so that in-flight bridge code compiles without
// rewriting every `from './...'` call site at once.
export { createPool } from '@method/runtime/sessions';
export type {
  SessionPool,
  SessionSnapshot,
  SessionBudget,
  SessionChainInfo,
  SessionMode,
  IsolationMode,
  WorktreeAction,
  WorktreeInfo,
  StaleConfig,
  SessionStatusInfo,
  PoolStats,
  PoolOptions,
} from '@method/runtime/sessions';

export {
  readMessages,
  createSessionChannels,
} from '@method/runtime/sessions';
export type { ChannelMessage, SessionChannels } from '@method/runtime/sessions';

// Bridge-owned surface — routes, persistence, transcripts stay here.
export { registerSessionRoutes } from './routes.js';
export type { SessionRouteDeps } from './routes.js';

export { registerTranscriptRoutes } from './transcript-route.js';
export { createTranscriptReader } from './transcript-reader.js';

export { createSessionPersistenceStore } from './session-persistence.js';
export type { SessionPersistenceStore, PersistedSession } from './session-persistence.js';
export { registerPersistenceRoutes } from './persistence-routes.js';
export type { PersistenceRouteDeps } from './persistence-routes.js';
