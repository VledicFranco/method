// ── PRD 012 Component 4: Diagnostic Instrumentation ─────────────
// Per-session timing metrics and stall detection.

export type StallReason = 'resource_contention' | 'permission_blocked' | 'task_complexity' | 'unknown';

export interface SessionDiagnostics {
  /** Time from spawn to first PTY output (ms). */
  time_to_first_output_ms: number | null;
  /** Time from spawn to first tool call detection (ms). */
  time_to_first_tool_ms: number | null;
  /** Total tool calls observed (from PTY watcher). */
  tool_call_count: number;
  /** Total settle delay overhead (sum of all settle waits, ms). Populated by Phase 2 adaptive settle. */
  total_settle_overhead_ms: number;
  /** Number of false-positive settle cutoffs detected. Populated by Phase 2 adaptive settle. */
  false_positive_settles: number;
  /** Current adaptive settle delay (ms). Populated by Phase 2 adaptive settle. */
  current_settle_delay_ms: number;
  /** Number of times the session went idle (back to prompt). */
  idle_transitions: number;
  /** Longest continuous idle period (ms). */
  longest_idle_ms: number;
  /** Whether the session ever received a permission prompt. */
  permission_prompt_detected: boolean;
  /** Stall classification (null if not stalled). */
  stall_reason: StallReason | null;
}

export function createSessionDiagnostics(settleDelayMs: number = 1000): SessionDiagnostics {
  return {
    time_to_first_output_ms: null,
    time_to_first_tool_ms: null,
    tool_call_count: 0,
    total_settle_overhead_ms: 0,
    false_positive_settles: 0,
    current_settle_delay_ms: settleDelayMs,
    idle_transitions: 0,
    longest_idle_ms: 0,
    permission_prompt_detected: false,
    stall_reason: null,
  };
}

/**
 * PRD 012 Component 4: Stall classification heuristic.
 *
 * Classifies why a session stalled based on observed diagnostics.
 * Called when a session transitions to idle without completing.
 *
 * | Condition                                                    | Classification       |
 * |--------------------------------------------------------------|----------------------|
 * | time_to_first_tool_ms === null (no tool calls ever)          | permission_blocked   |
 * | tool_call_count > 0 AND idle_transitions > 3                 | task_complexity      |
 * | time_to_first_output_ms > 10000 AND other agents also slow   | resource_contention  |
 * | None of the above                                            | unknown              |
 */
export function classifyStall(
  diagnostics: SessionDiagnostics,
  otherSessionsSlow: boolean = false,
): StallReason {
  // No tool calls ever → likely hit permission prompt on first tool
  if (diagnostics.time_to_first_tool_ms === null) {
    return 'permission_blocked';
  }

  // Had tool calls but went idle repeatedly → task complexity
  if (diagnostics.tool_call_count > 0 && diagnostics.idle_transitions > 3) {
    return 'task_complexity';
  }

  // Slow first output AND other agents also slow → resource contention
  if (
    diagnostics.time_to_first_output_ms !== null &&
    diagnostics.time_to_first_output_ms > 10000 &&
    otherSessionsSlow
  ) {
    return 'resource_contention';
  }

  return 'unknown';
}
