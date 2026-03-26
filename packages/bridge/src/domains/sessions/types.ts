/** Sessions domain — collected type re-exports. */

// Pool types
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

// Session types (moved from pty-session.ts in PRD 028 C-4)
export type { PtySession, SessionStatus, AdaptiveSettleDelay } from './print-session.js';

// Auto-retro observation type
export type { ActivityObservation } from './auto-retro.js';

// Channel types
export type { ChannelMessage, Channel, SessionChannels } from './channels.js';

// Transcript reader types
export type { TranscriptToolCall, TranscriptTurn, SessionSummary, TranscriptReader } from './transcript-reader.js';

// Route types
export type { SessionRouteDeps } from './routes.js';

// Diagnostics types
export type { SessionDiagnostics } from './diagnostics.js';

// Config types
export type { SessionsConfig } from './config.js';
