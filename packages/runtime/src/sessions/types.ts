// SPDX-License-Identifier: Apache-2.0
/**
 * Sessions domain — collected type re-exports (PRD-057 / S2 §3.3 / C5).
 *
 * Transcript reader, routes, and `SessionsConfig` types live in
 * `@methodts/bridge` — this barrel now re-exports only the types that
 * belong to the runtime subpath. Bridge-internal code that needs the
 * full historical bundle should import the specific modules directly.
 */

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
  StreamEvent,
} from './pool.js';

// Session types (moved from pty-session.ts in PRD 028 C-4)
export type { PtySession, SessionStatus, AdaptiveSettleDelay } from './print-session.js';

// Auto-retro observation type
export type { ActivityObservation } from './auto-retro.js';

// Channel types
export type { ChannelMessage, Channel, SessionChannels } from './channels.js';

// Diagnostics types
export type { SessionDiagnostics } from './diagnostics.js';

// Cognitive types
export type {
  CognitiveSessionConfig,
  CognitiveSessionOptions,
} from './cognitive-provider.js';
export type { CognitiveEventContext } from './cognitive-sink.js';
