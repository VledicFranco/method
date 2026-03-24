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

// PTY session types
export type { PtySession, SessionStatus, SpawnOptions } from './pty-session.js';

// Channel types
export type { ChannelMessage, Channel, SessionChannels, OnMessageCallback } from './channels.js';

// Transcript reader types
export type { TranscriptToolCall, TranscriptTurn, SessionSummary, TranscriptReader } from './transcript-reader.js';

// Route types
export type { SessionRouteDeps } from './routes.js';

// Diagnostics types
export type { SessionDiagnostics } from './diagnostics.js';

// PTY watcher types
export type { ObservationCallback, ScopeViolationCallback, ActivityObservation, WatcherConfig, PtyWatcher } from './pty-watcher.js';

// Pattern matcher types
export type { ObservationCategory, PatternMatch, PatternMatcher } from './pattern-matchers.js';

// Config types
export type { SessionsConfig } from './config.js';
