/**
 * @method/runtime/sessions — session pool + providers + supporting
 * machinery. PRD-057 / S2 §3.3 / C5 public surface.
 *
 * The pool stays transport-free. Bridge provides its PTY-spawning
 * `SessionProviderFactory` (see `packages/bridge/src/domains/sessions/factory.ts`);
 * agent-runtime (PRD-058) will provide a Cortex-backed factory.
 */

// ── Pool ────────────────────────────────────────────────────────

export { createPool } from './pool.js';
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
  StreamEvent,
} from './pool.js';

// ── Print session ───────────────────────────────────────────────

export { createPrintSession } from './print-session.js';
export type {
  PtySession,
  PrintMetadata,
  SessionStatus,
  StreamChunkCallback,
  AdaptiveSettleDelay,
  PactaSessionParams,
  PrintSessionOptions,
} from './print-session.js';

// ── Cognitive session ───────────────────────────────────────────

export { createCognitiveSession } from './cognitive-provider.js';
export type {
  CognitiveSessionConfig,
  CognitiveSessionOptions,
} from './cognitive-provider.js';

// ── Cognitive modules (registrable factories) ───────────────────

export {
  createBridgeReasonerActorModule,
  createBridgeReasonerActorModule as createReasonerActorModule,
  createBridgeMonitorModule,
  createBridgeMonitorModule as createMonitorModule,
} from './cognitive-modules.js';
export type {
  BridgeReasonerActorMonitoring,
  BridgeMonitorControl,
} from './cognitive-modules.js';

// ── Cognitive event-bus sink (PRD-057 / S2 §14 Q6 rename) ───────

export { CognitiveEventBusSink } from './cognitive-sink.js';
export { CognitiveEventBusSink as CognitiveSink } from './cognitive-sink.js';
export type { CognitiveEventContext } from './cognitive-sink.js';

// ── Channels + diagnostics ──────────────────────────────────────

export {
  createSessionChannels,
  appendMessage,
  readMessages,
  getChannelRing,
  ChannelRingBuffer,
} from './channels.js';
export type { SessionChannels, Channel, ChannelMessage } from './channels.js';

export { DiagnosticsTracker } from './diagnostics.js';
export type { SessionDiagnostics } from './diagnostics.js';

// ── Scope enforcement ───────────────────────────────────────────

export { installScopeHook } from './scope-hook.js';

// ── Spawn queue + auto-retro ────────────────────────────────────

export { SpawnQueue } from './spawn-queue.js';
export type { SpawnQueueOptions } from './spawn-queue.js';

export { generateAutoRetro } from './auto-retro.js';
export type { AutoRetroInput, ActivityObservation } from './auto-retro.js';

// ── Runtime tool provider (ex bridge-tools) ─────────────────────

export {
  createRuntimeToolProvider,
  createBridgeToolProvider,
} from './runtime-tools.js';
