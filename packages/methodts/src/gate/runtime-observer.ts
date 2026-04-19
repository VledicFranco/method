// SPDX-License-Identifier: Apache-2.0
/**
 * RuntimeObserver — Lightweight observation hook for runtime events.
 *
 * Designed for visual app frontends that need real-time visibility into
 * gate evaluation, node execution, and retry attempts. Injected optionally
 * via executeWithRetry() and strategy executor config.
 *
 * @see PRD 046 §Surfaces — RuntimeObserver
 * @see exp-spl-design — empirical evidence for gate lifecycle events
 */

// ── Port interface ──

/**
 * Observation hook for runtime events. All methods are fire-and-forget
 * (void return) — observers must not block execution.
 *
 * Consumers: bridge (visual app), strategy executor (BridgeEvent adapter).
 */
export interface RuntimeObserver {
  /** A gate was evaluated — pass or fail. */
  onGateEvaluated(event: GateEvaluatedEvent): void;

  /** A node (strategy node, semantic function, method step) started execution. */
  onNodeStarted(event: NodeStartedEvent): void;

  /** A node completed execution with cost data. */
  onNodeCompleted(event: NodeCompletedEvent): void;

  /** A retry attempt was triggered after gate failure. */
  onRetryAttempt(event: RetryAttemptEvent): void;
}

// ── Event types ──

export interface GateEvaluatedEvent {
  readonly gateId: string;
  readonly passed: boolean;
  readonly attempt: number;
  readonly detail: string;
}

export interface NodeStartedEvent {
  readonly nodeId: string;
  readonly type: string;
}

export interface NodeCompletedEvent {
  readonly nodeId: string;
  readonly cost: {
    readonly tokens: number;
    readonly usd: number;
    readonly duration_ms: number;
  };
}

export interface RetryAttemptEvent {
  readonly name: string;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly feedback: string;
}

// ── Null implementation (no-op) ──

/** No-op observer — used when no observer is provided. */
export const nullObserver: RuntimeObserver = {
  onGateEvaluated() {},
  onNodeStarted() {},
  onNodeCompleted() {},
  onRetryAttempt() {},
};
