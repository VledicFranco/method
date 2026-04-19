// SPDX-License-Identifier: Apache-2.0
/**
 * ObservabilityPort — Structured observability signal for fca-index domains.
 *
 * Owner:       @methodts/fca-index
 * Callers:     query, index-store (future: scanner, coverage, compliance)
 * Implementers:
 *   - StderrObservabilitySink (fca-index/cli)     — standalone / CLI default
 *   - RecordingObservabilitySink (fca-index/testkit) — test doubles
 *   - BridgeEventBusObservabilitySink (future)    — wire into PRD 026 event bus
 * Direction:   fca-index domain code → sink (unidirectional, fire-and-forget)
 * Co-designed: 2026-04-13
 * Status:      frozen
 * Record:      .method/sessions/fcd-surface-fca-index-observability/record.md
 *
 * Design principles:
 *   - One method (`emit`). Callers never care about success/failure of emission.
 *   - Non-throwing contract. Observability must never break the operation
 *     being observed. Sinks MUST catch/swallow internal errors.
 *   - Self-contained event shape. No fca-index domain types leak.
 *   - Extensible through `fields`, not through growing the method set.
 *
 * When MCP or pacta need the same shape, extract `ObservabilityPort` + types
 * to a shared L2 package. Until then, fca-index owns it alone (YAGNI).
 */

// ── Port interface ───────────────────────────────────────────────────────────

export interface ObservabilityPort {
  /**
   * Emit a structured observability event. Fire-and-forget.
   *
   * Implementations MUST NOT throw. Observability failures (full pipe, broken
   * downstream bus, serialization error) must be swallowed so the domain
   * operation continues unaffected.
   */
  emit(event: ObservabilityEvent): void;
}

// ── Event shape ──────────────────────────────────────────────────────────────

/**
 * A single observability signal. All fields except `event`, `scope`, and `ts`
 * are optional so emitters can keep call sites lean.
 */
export interface ObservabilityEvent {
  /**
   * Stable event name within the scope. Convention: `<phase>` or `<phase>.<sub>`.
   * Examples: `start`, `done`, `error`, `rate_limited`, `batch_progress`.
   */
  event: string;

  /**
   * Scope/domain prefix. Display form is typically `[<package>.<scope>]`.
   * Examples: `query`, `embed`, `scan`, `compliance`.
   */
  scope: string;

  /** ISO 8601 timestamp, filled by the emitter (not the sink). */
  ts: string;

  /** Severity hint for sink-side filtering. Defaults to `info` when omitted. */
  severity?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Event-specific structured payload. Flat key-value preferred.
   * Sinks that serialize to JSON should accept any JSON-compatible value;
   * functions, circular refs, and Date objects MAY be lossy.
   */
  fields?: Record<string, unknown>;

  /** Optional error reference. Conventionally paired with `severity: 'error'`. */
  error?: {
    message: string;
    code?: string;
  };
}

// ── Null sink (default) ──────────────────────────────────────────────────────

/**
 * No-op implementation. Use when observability isn't wired (standalone tests,
 * minimal integrations). Safe default — never throws, never allocates.
 */
export class NullObservabilitySink implements ObservabilityPort {
  emit(_event: ObservabilityEvent): void {
    /* no-op */
  }
}

// ── Helper for emitters ──────────────────────────────────────────────────────

/**
 * Convenience builder used at call sites so emitters don't repeat the `ts` and
 * `scope` arguments. Returns a bound emit function for a specific scope.
 *
 *   const obs = scoped(this.observer, 'query');
 *   obs('start', { query, topK });
 *   obs('done',  { results: 5 }, 'info');
 *
 * Keeps call-site noise low without expanding the port's method set.
 */
export function scoped(
  port: ObservabilityPort,
  scope: string,
): (event: string, fields?: Record<string, unknown>, severity?: ObservabilityEvent['severity']) => void {
  return (event, fields, severity) => {
    port.emit({
      event,
      scope,
      ts: new Date().toISOString(),
      severity,
      fields,
    });
  };
}
