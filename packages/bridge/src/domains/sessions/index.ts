/** Sessions domain barrel — pool, channels, routes, and supporting infrastructure. */

export { createPool } from './pool.js';
export type {
  SessionPool,
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
} from './pool.js';

export {
  readMessages,
  createSessionChannels,
} from './channels.js';
export type { ChannelMessage, SessionChannels } from './channels.js';

export { registerSessionRoutes } from './routes.js';
export type { SessionRouteDeps } from './routes.js';

export { registerLiveOutputRoutes } from './live-output-route.js';
export { registerTranscriptRoutes } from './transcript-route.js';
export { createTranscriptReader } from './transcript-reader.js';

export { createSessionPersistenceStore } from './session-persistence.js';
export type { SessionPersistenceStore, PersistedSession } from './session-persistence.js';
export { registerPersistenceRoutes } from './persistence-routes.js';
export type { PersistenceRouteDeps } from './persistence-routes.js';
