// ── PRD 012 Phase 1: Diagnostic Instrumentation ─────────────────
// Per-session timing metrics and stall detection.

import { type AdaptiveSettleDelay } from './adaptive-settle.js';

export interface SessionDiagnostics {
  /** Time from spawn to first PTY output (ms). */
  time_to_first_output_ms: number | null;
  /** Time from spawn to first tool call detection (ms). */
  time_to_first_tool_ms: number | null;
  /** Total tool calls observed (from PTY watcher). */
  tool_call_count: number;
  /** Total settle delay overhead (sum of all settle waits, ms). */
  total_settle_overhead_ms: number;
  /** Number of false-positive settle cutoffs detected. */
  false_positive_settles: number;
  /** Current adaptive settle delay (ms). */
  current_settle_delay_ms: number;
  /** Number of times the session went idle (back to prompt). */
  idle_transitions: number;
  /** Longest continuous idle period (ms). */
  longest_idle_ms: number;
  /** Whether the session ever received a permission prompt. */
  permission_prompt_detected: boolean;
  /** Stall classification (null if not stalled). */
  stall_reason: 'resource_contention' | 'permission_blocked' | 'task_complexity' | 'unknown' | null;
}

/**
 * Per-session diagnostics tracker. Created at spawn, collects metrics
 * throughout the session lifetime, produces snapshots on demand.
 */
export class DiagnosticsTracker {
  private readonly spawnedAt: number;
  private firstOutputAt: number | null = null;
  private firstToolAt: number | null = null;
  private _toolCallCount = 0;
  private _totalSettleOverheadMs = 0;
  private _falsePositiveSettles = 0;
  private readonly _settleDelayMs: number;
  private _idleTransitions = 0;
  private _longestIdleMs = 0;
  private _idleStartedAt: number | null = null;
  private _permissionPromptDetected = false;
  /** PRD 012 Phase 2: Optional adaptive settle reference for dynamic metrics. */
  private readonly _adaptiveSettle: AdaptiveSettleDelay | null;

  constructor(settleDelayMs: number, adaptiveSettle?: AdaptiveSettleDelay | null) {
    this.spawnedAt = Date.now();
    this._settleDelayMs = settleDelayMs;
    this._adaptiveSettle = adaptiveSettle ?? null;
  }

  /** Called on first PTY data chunk. */
  recordFirstOutput(): void {
    if (this.firstOutputAt === null) {
      this.firstOutputAt = Date.now();
    }
  }

  /** Called when PTY watcher detects a tool call. */
  recordToolCall(): void {
    this._toolCallCount++;
    if (this.firstToolAt === null) {
      this.firstToolAt = Date.now();
    }
    // Tool call ends any idle period
    this.endIdlePeriod();
  }

  /** Called when PTY watcher detects an idle transition (prompt char after activity). */
  recordIdleTransition(): void {
    this._idleTransitions++;
    this._idleStartedAt = Date.now();
  }

  /** Called when any non-idle activity is detected — ends the current idle period. */
  recordActivity(): void {
    this.endIdlePeriod();
  }

  /** Called when a permission prompt is detected in PTY output. */
  recordPermissionPrompt(): void {
    this._permissionPromptDetected = true;
  }

  /** Called after each prompt response completes. Adds one settle wait to overhead. */
  recordPromptCompletion(): void {
    // PRD 012 Phase 2: Use adaptive delay if available, otherwise fixed
    const effectiveDelay = this._adaptiveSettle
      ? this._adaptiveSettle.delayMs
      : this._settleDelayMs;
    this._totalSettleOverheadMs += effectiveDelay;
  }

  /** Returns current diagnostics snapshot. */
  snapshot(): SessionDiagnostics {
    // Compute longest idle including current idle period if active
    let longestIdle = this._longestIdleMs;
    if (this._idleStartedAt !== null) {
      const currentIdle = Date.now() - this._idleStartedAt;
      if (currentIdle > longestIdle) longestIdle = currentIdle;
    }

    return {
      time_to_first_output_ms: this.firstOutputAt !== null
        ? this.firstOutputAt - this.spawnedAt
        : null,
      time_to_first_tool_ms: this.firstToolAt !== null
        ? this.firstToolAt - this.spawnedAt
        : null,
      tool_call_count: this._toolCallCount,
      total_settle_overhead_ms: this._totalSettleOverheadMs,
      // PRD 012 Phase 2: Report false positives from adaptive settle
      false_positive_settles: this._adaptiveSettle
        ? this._adaptiveSettle.falsePositiveCount
        : this._falsePositiveSettles,
      // PRD 012 Phase 2: Report current adaptive delay if available
      current_settle_delay_ms: this._adaptiveSettle
        ? this._adaptiveSettle.delayMs
        : this._settleDelayMs,
      idle_transitions: this._idleTransitions,
      longest_idle_ms: longestIdle,
      permission_prompt_detected: this._permissionPromptDetected,
      stall_reason: null, // Computed externally by pool when session is idle
    };
  }

  /**
   * Classify the stall reason for an idle session.
   * Called by the pool when building status for a stale/idle session.
   *
   * PRD 012 heuristic:
   * - No tool calls ever → permission_blocked
   * - Tool calls + many idle transitions → task_complexity
   * - Slow first output + other agents slow → resource_contention
   * - None of above → unknown
   */
  classifyStall(otherSessionsSlow: boolean): SessionDiagnostics['stall_reason'] {
    if (this.firstToolAt === null) {
      return 'permission_blocked';
    }
    if (this._toolCallCount > 0 && this._idleTransitions > 3) {
      return 'task_complexity';
    }
    if (this.firstOutputAt !== null
      && (this.firstOutputAt - this.spawnedAt) > 10_000
      && otherSessionsSlow) {
      return 'resource_contention';
    }
    return 'unknown';
  }

  private endIdlePeriod(): void {
    if (this._idleStartedAt !== null) {
      const idleDuration = Date.now() - this._idleStartedAt;
      if (idleDuration > this._longestIdleMs) {
        this._longestIdleMs = idleDuration;
      }
      this._idleStartedAt = null;
    }
  }
}
