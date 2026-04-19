// SPDX-License-Identifier: Apache-2.0
/**
 * Execution Modes — behavioral contracts for how an agent runs.
 *
 * Streaming is orthogonal — any mode can stream events via the
 * `streaming` field on the Pact, not as a mode variant.
 */

export type ExecutionMode =
  | OneshotMode
  | ResumableMode
  | PersistentMode;

/** Invoke, get result, done. No state survives between invocations. */
export interface OneshotMode {
  type: 'oneshot';
}

/** Invoke, get result, can resume later with full prior context. */
export interface ResumableMode {
  type: 'resumable';
  sessionId?: string;
}

/** Spawn a long-lived agent. Multiple prompt/response cycles. Must explicitly kill. */
export interface PersistentMode {
  type: 'persistent';
  keepAlive?: boolean;
  idleTimeoutMs?: number;
}

export interface StreamOptions {
  format?: 'events' | 'text';
}
