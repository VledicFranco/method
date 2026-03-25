/**
 * Execution Modes — behavioral contracts for how an agent runs.
 *
 * Each mode is a promise about the agent's lifecycle:
 * - oneshot:    one invocation, one result, no state survives
 * - resumable:  one result per invocation, can resume with prior context
 * - persistent: long-lived process, multiple prompt/response cycles
 * - streaming:  one invocation, typed event stream until completion
 */

export type ExecutionMode =
  | OneshotMode
  | ResumableMode
  | PersistentMode
  | StreamingMode;

/** Invoke, get result, done. No state survives between invocations. */
export interface OneshotMode {
  type: 'oneshot';
}

/** Invoke, get result, can resume later with full prior context. */
export interface ResumableMode {
  type: 'resumable';
  /** Existing session to resume (omit to start fresh) */
  sessionId?: string;
}

/** Spawn a long-lived agent. Multiple prompt/response cycles. Must explicitly kill. */
export interface PersistentMode {
  type: 'persistent';
  /** Keep the agent alive after idle timeout (default: false) */
  keepAlive?: boolean;
  /** Idle timeout before the agent is considered stale (ms) */
  idleTimeoutMs?: number;
}

/** Invoke and receive a typed event stream. Stream terminates on completion. */
export interface StreamingMode {
  type: 'streaming';
  /** Event format: full lifecycle events or just text deltas */
  format?: 'events' | 'text';
}
