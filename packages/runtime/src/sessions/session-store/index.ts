// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/runtime/sessions/session-store — PRD-061 composition surface.
 *
 * Re-exports the SessionStore port, default CheckpointSink implementation,
 * adapter-agnostic resume algorithm, and the in-memory reference store used
 * by the pacta-testkit conformance fixtures and unit tests.
 */

export type { SessionStore } from '../../ports/session-store.js';
export type {
  SessionStatus,
  PactRef,
  SessionSnapshot,
  EventCursor,
  AgentStateBlob,
  BudgetReservation,
  NextAction,
  Checkpoint,
  CheckpointMeta,
  ResumeOptions,
  ResumeContext,
} from '../../ports/session-store-types.js';
export {
  SessionStoreError,
  isSessionStoreError,
} from '../../ports/session-store-errors.js';
export type {
  SessionStoreErrorCode,
  SessionStoreErrorOptions,
} from '../../ports/session-store-errors.js';
export type {
  CheckpointSink,
  CheckpointSinkOptions,
  CheckpointCapture,
} from '../../ports/checkpoint-sink.js';

export { createCheckpointSink, SESSION_LIFECYCLE_TYPES } from './checkpoint-sink-impl.js';
export {
  performResume,
  startLeaseHeartbeat,
} from './resume.js';
export type {
  BudgetEnforcer,
  ResumedPact,
  LeaseHeartbeat,
  PerformResumeArgs,
  ResumeOutcome,
  TimerBindings,
} from './resume.js';

export { createInMemorySessionStore } from './in-memory-session-store.js';
export type { InMemorySessionStoreOptions } from './in-memory-session-store.js';

// ── Conformance fixtures (PRD-061 §8.2) ──
export {
  DEFAULT_SESSION_STORE_FIXTURES,
  resumeMidTurnFixture,
  staleLeaseTheftFixture,
  schemaVersionRejectionFixture,
  runSessionStoreConformance,
} from './conformance.js';
export type {
  SessionStoreConformanceFixture,
  SessionStoreFactory,
  FixtureResult,
} from './conformance.js';
