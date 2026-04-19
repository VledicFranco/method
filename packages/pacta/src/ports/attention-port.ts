// SPDX-License-Identifier: Apache-2.0
/**
 * Attention Port — event-driven stimuli for multi-sense cognitive agents (PRD 032, P8).
 *
 * Cognitive agents receive input beyond prompts: test results, file changes, lint errors,
 * timers, memory triggers. The AttentionPort provides a unified interface for these stimuli,
 * and the AttentionFilter module decides which enter the workspace based on priority and
 * relevance to the current task.
 *
 * Named CognitiveStimulus (not CognitiveEvent) to avoid collision with algebra/events.ts.
 *
 * Grounded in: Broadbent's filter model, Treisman's attenuation model, GWT sensory broadcast.
 */

// ── Stimulus Types ───────────────────────────────────────────

export interface CognitiveStimulus {
  /** Type of stimulus. */
  type: 'tool-result' | 'test-result' | 'file-changed' | 'lint-error' | 'timer' | 'user-message' | 'memory-trigger';
  /** Priority level — determines attention filter behavior. */
  priority: 'high' | 'medium' | 'low';
  /** Stimulus content (type-specific). */
  content: unknown;
  /** Source identifier (e.g. tool name, file path, timer label). */
  source: string;
  /** Timestamp when the stimulus was generated. */
  timestamp: number;
}

// ── Attention Port ───────────────────────────────────────────

export interface AttentionPort {
  /** Subscribe to stimuli matching a filter predicate. */
  subscribe(filter: (event: CognitiveStimulus) => boolean): void;

  /** Poll for pending stimuli (non-blocking). Returns and clears the queue. */
  poll(): CognitiveStimulus[];

  /** Push a stimulus into the attention system. */
  emit(stimulus: CognitiveStimulus): void;
}
