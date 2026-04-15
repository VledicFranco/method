/**
 * SessionStore + Checkpoint type definitions — PRD-061 / S4 §4.3.
 *
 * Owner: @method/runtime
 * Frozen: 2026-04-14 (FCD surface `fcd-surface-session-store`)
 *
 * These types flow across the port interface and are serialized to every
 * backing store. They MUST remain backend-neutral: no Mongo / BSON / file
 * handle types are permitted to appear in these signatures (gate
 * G-SESSIONSTORE-PORT-PURITY).
 */

export type SessionStatus =
  | 'initializing'
  | 'running'
  | 'idle'
  | 'paused'      // lease held, waiting for event / human
  | 'suspended'   // no lease, waiting for JobQueue reinvocation
  | 'completed'
  | 'failed'
  | 'dead';

/** Opaque reference to the pact that produced this session. */
export interface PactRef {
  readonly id: string;
  readonly version: string;
  /** Hash of the resolved pact document — detects drift on resume. */
  readonly fingerprint: string;
}

/**
 * The canonical session-state envelope persisted by every SessionStore.
 *
 * Envelope version is frozen at 1 in v1 of the surface. Unknown schema
 * versions MUST be rejected with `SCHEMA_INCOMPATIBLE` — silent coercion is
 * explicitly forbidden.
 */
export interface SessionSnapshot {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  /** Stable scope id — appId in Cortex, workdir path in bridge. */
  readonly scopeId: string;
  readonly pactRef: PactRef;
  readonly status: SessionStatus;
  readonly createdAt: string;   // ISO 8601
  readonly updatedAt: string;   // ISO 8601
  /** Sequence of the latest appended checkpoint, or null if none. */
  readonly latestCheckpointSequence: number | null;
  readonly nickname?: string;
  readonly parentSessionId?: string;
  readonly depth: number;
  /** Free-form per-adapter metadata — opaque to consumers. */
  readonly metadata?: Record<string, unknown>;
}

/** Cursor into the bus event stream. */
export interface EventCursor {
  readonly sequence: number;
  readonly id: string;
}

/**
 * Opaque blob from the agent's perspective. The adapter stores it; the
 * runtime parses it. Large blobs (>16KB recommended threshold) should be
 * written to an external blob ref.
 */
export type AgentStateBlob =
  | { readonly kind: 'inline'; readonly data: Record<string, unknown> }
  | { readonly kind: 'blob-ref'; readonly ref: string; readonly sizeBytes: number };

/** Durable reservation handle for an active LLM budget. */
export interface BudgetReservation {
  readonly handle: string;
  readonly expiresAt: string;   // ISO 8601
  readonly amount: { readonly usd: number; readonly tokens: number };
  /** Issuer tag — 'ctx.llm' | 'bridge/cost-governor' | ... */
  readonly issuer: string;
}

/** Advisory hint for what the runtime should do on resume. */
export type NextAction =
  | { readonly kind: 'await-prompt' }
  | { readonly kind: 'continue-turn'; readonly pendingToolCalls?: readonly string[] }
  | { readonly kind: 'await-human-approval'; readonly gateId: string }
  | { readonly kind: 'await-schedule'; readonly wakeAt: string }
  | { readonly kind: 'terminal'; readonly status: SessionStatus };

/** One durable checkpoint. Append-only, monotonic per session. */
export interface Checkpoint {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly sessionId: string;
  readonly createdAt: string;   // ISO 8601
  readonly eventCursor: EventCursor;
  readonly agentState: AgentStateBlob;
  readonly pendingBudget: BudgetReservation | null;
  readonly nextAction: NextAction;
  readonly note?: string;
}

/** Lightweight checkpoint projection for listing. */
export interface CheckpointMeta {
  readonly sequence: number;
  readonly createdAt: string;
  readonly note?: string;
  readonly nextAction: NextAction;
}

/** Options accepted by `SessionStore.resume`. */
export interface ResumeOptions {
  /** Requested lease TTL in ms. Store may clamp. Default 30_000. */
  readonly leaseTtlMs?: number;
  /** If true, require the pact fingerprint to match. Default true. */
  readonly requireFingerprint?: boolean;
  /** Optional fingerprint to match against `snapshot.pactRef.fingerprint`. */
  readonly expectedFingerprint?: string;
}

/** Result of a successful `resume()` call. */
export interface ResumeContext {
  readonly snapshot: SessionSnapshot;
  readonly checkpoint: Checkpoint | null;
  readonly fencingToken: string;
  readonly leaseExpiresAt: string;
  /**
   * Populated only if the adapter was wired with an EventReader.
   * Callers without a reader should coordinate replay themselves.
   */
  readonly replayHint?: { readonly fromSequence: number; readonly fromEventId: string };
}
