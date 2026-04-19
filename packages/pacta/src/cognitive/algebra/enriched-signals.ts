// SPDX-License-Identifier: Apache-2.0
/**
 * Enriched Signal Types — v2 monitoring signals with metacognitive taxonomy,
 * prediction-error tracking, and precision weighting.
 *
 * These types extend the base MonitoringSignal from module.ts without breaking
 * the CognitiveModule contract. Consumers that only need v1 fields see v1 fields;
 * consumers that understand v2 check for enriched fields.
 *
 * Grounded in:
 * - Nelson & Narens (1990) — metacognitive judgment taxonomy (EOL, JOL, FOK, RC)
 * - Friston (2009, 2010) — prediction-error tracking, precision weighting
 * - Botvinick et al. (2001, 2004) — conflict monitoring, Gratton effect
 * - Laird, Newell, Rosenbloom (1987) — SOAR impasse taxonomy
 * - Da Costa et al. (2024), Shenhav et al. (2013) — EVC, effort allocation
 * - Desimone & Duncan (1995), Awh et al. (2012) — biased competition, priority
 *
 * See docs/prds/035-cognitive-monitoring-control-v2.md for full design.
 */

import type { ModuleId, MonitoringSignal } from './module.js';
import type { ReasonerActorMonitoring } from './module.js';
import type { ReasonerActorConfig } from '../modules/reasoner-actor.js';

// ── Metacognitive Judgment Taxonomy ─────────────────────────────

/**
 * Metacognitive judgment types following Nelson & Narens (1990).
 *
 * Each judgment type triggers a different control response:
 * - EOL: Allocate more tokens, deeper strategy
 * - JOL: Switch strategy if low, persist if adequate
 * - FOK: Persist with different retrieval cues
 * - RC:  Withhold output if low, seek verification
 */
export type MetacognitiveJudgment = 'eol' | 'jol' | 'fok' | 'rc';

// ── Enriched Monitoring Signal ──────────────────────────────────

/**
 * Enriched monitoring signal extending the base MonitoringSignal.
 *
 * All fields beyond MonitoringSignal are optional — a signal may carry
 * only the judgments relevant to the current module and cycle phase.
 * Structurally assignable to MonitoringSignal without cast.
 */
export interface EnrichedMonitoringSignal extends MonitoringSignal {
  // Nelson & Narens (1990) metacognitive taxonomy
  /** Ease of Learning — predicted difficulty before task (0 = easy, 1 = hard). */
  eol?: number;
  /** Judgment of Learning — current mastery estimate (0 = no mastery, 1 = full mastery). */
  jol?: number;
  /** Feeling of Knowing — partial match detected but retrieval failed. */
  fok?: boolean;
  /** Retrospective Confidence — post-hoc accuracy estimate (0 = uncertain, 1 = certain). */
  rc?: number;

  // Friston (2009) prediction error
  /** Deviation from expected module behavior. Magnitude, not direction. */
  predictionError?: number;
  /** Reliability weight of this signal — inverse variance of source's error history. */
  precision?: number;

  // Botvinick (2001) conflict monitoring
  /** Co-activation energy of incompatible responses. 0 = no conflict. */
  conflictEnergy?: number;
}

// ── Module Expectation Model ────────────────────────────────────

/**
 * Expectation model for a single module — what MonitorV2 predicts about its behavior.
 *
 * Updated incrementally via exponential moving average after each cycle.
 * Prediction error = |observed - expected| / sqrt(variance).
 */
export interface ModuleExpectation {
  /** Expected confidence range [min, max]. */
  confidenceRange: [number, number];
  /** Expected step duration in ms. */
  expectedDurationMs: number;
  /** Running mean of observed confidence. */
  meanConfidence: number;
  /** Running variance of observed confidence. */
  varianceConfidence: number;
  /** Number of observations used to build this expectation. */
  observations: number;
  /** Exponential moving average decay factor. */
  alpha: number;
}

// ── MonitorV2 State ─────────────────────────────────────────────

/**
 * MonitorV2 internal state.
 *
 * Tracks per-module expectations, precision weights, adaptive threshold
 * (Gratton effect), and backward-compatible v1 counters.
 */
export interface MonitorV2State {
  /** Per-module expectation models. */
  expectations: Map<ModuleId, ModuleExpectation>;
  /** Per-module precision weights (inverse variance, normalized). */
  precisionWeights: Map<ModuleId, number>;
  /** Current adaptive threshold — adjusts via Gratton effect. */
  adaptiveThreshold: number;
  /** Whether the previous cycle triggered an intervention. */
  previousCycleIntervened: boolean;
  /** Consecutive intervention cycles (for meta-intervention cooldown). */
  consecutiveInterventions: number;
  /** Cycle counter. */
  cycleCount: number;
  /** Conflict count. */
  conflictCount: number;
  /** Running confidence average (backward-compat with v1 report consumers). */
  confidenceAverage: number;
  /** Confidence observation count. */
  confidenceObservations: number;
  /** Consecutive read-only cycles. */
  consecutiveReadOnlyCycles: number;
  /** Recent action inputs for stagnation disambiguation. */
  recentActionInputs: string[];
}

// ── MonitorV2 Config ────────────────────────────────────────────

/**
 * Configuration for MonitorV2.
 *
 * All fields are optional with sensible defaults. The Gratton effect
 * adjusts `baseConfidenceThreshold` adaptively within [thresholdFloor, thresholdCeiling].
 */
export interface MonitorV2Config {
  /** Base confidence threshold. Gratton effect adjusts this adaptively. Default: 0.3. */
  baseConfidenceThreshold?: number;
  /** Gratton adjustment magnitude — how much thresholds shift per cycle. Default: 0.05. */
  grattonDelta?: number;
  /** Minimum adaptive threshold floor. Default: 0.1. */
  thresholdFloor?: number;
  /** Maximum adaptive threshold ceiling. Default: 0.6. */
  thresholdCeiling?: number;
  /** Prediction error significance threshold. Default: 1.5 (1.5 std deviations). */
  predictionErrorThreshold?: number;
  /** Exponential moving average decay for expectation model. Default: 0.2. */
  expectationAlpha?: number;
  /** Stagnation threshold (consecutive read-only cycles). Default: 3. */
  stagnationThreshold?: number;
  /** Module ID override. Default: 'monitor'. */
  id?: string;
}

// ── Impasse Types ───────────────────────────────────────────────

/**
 * Impasse type taxonomy following SOAR (Laird, Newell, Rosenbloom 1987).
 *
 * Each impasse type implies a specific resolution strategy — the subgoal
 * is generated from the impasse type, not pre-programmed.
 */
export type ImpasseType = 'tie' | 'no-change' | 'rejection' | 'stall';

/**
 * Signal emitted when an impasse is detected.
 *
 * The autoSubgoal field contains the auto-generated subgoal string
 * that resolves this specific impasse type.
 */
export interface ImpasseSignal {
  /** Which type of impasse was detected. */
  type: ImpasseType;
  /** The tied candidates (for 'tie' impasses). */
  candidates?: string[];
  /** How many cycles the agent has been stuck (for 'stall' impasses). */
  stuckCycles?: number;
  /** The failed tool name (for 'rejection' impasses). */
  failedTool?: string;
  /** The auto-generated subgoal to resolve this impasse. */
  autoSubgoal: string;
}

// ── ReasonerActorV2 Monitoring & Config ─────────────────────────

/**
 * Extended monitoring signal for ReasonerActorV2.
 *
 * Extends ReasonerActorMonitoring with optional impasse detection.
 * Structurally assignable to ReasonerActorMonitoring without cast.
 */
export interface ReasonerActorV2Monitoring extends ReasonerActorMonitoring {
  /** Impasse signal, present only when an impasse is detected. */
  impasse?: ImpasseSignal;
}

/**
 * Configuration for ReasonerActorV2.
 *
 * Extends ReasonerActorConfig with impasse detection parameters.
 */
export interface ReasonerActorV2Config extends ReasonerActorConfig {
  /** Action entropy threshold below which a stall impasse is detected. Default: 0.3. */
  stallEntropyThreshold?: number;
  /** Number of repeated actions before no-change impasse fires. Default: 2. */
  noChangeThreshold?: number;
  /** Whether to inject auto-subgoals into the workspace. Default: true. */
  injectSubgoals?: boolean;
  /** Salience of injected subgoal entries. Default: 0.9 (high priority). */
  subgoalSalience?: number;
}

// ── Priority Attention Types ────────────────────────────────────

/**
 * Three-factor priority score for a workspace entry.
 *
 * Follows Desimone & Duncan (1995) biased competition and
 * Awh, Belopolsky & Theeuwes (2012) three-factor attention model.
 */
export interface PriorityScore {
  /** Bottom-up: novelty, magnitude, surprise. Range [0, 1]. */
  stimulusSalience: number;
  /** Top-down: match to active plan/subgoals. Range [0, 1]. */
  goalRelevance: number;
  /** Learned bias: items previously attended that led to progress. Range [-1, 1]. */
  selectionHistory: number;
  /** Composite priority: weighted sum. */
  composite: number;
}

/**
 * Configuration for PriorityAttend.
 *
 * Weights default to the empirically-balanced distribution:
 * stimulus 0.3, goal 0.4, history 0.3.
 */
export interface PriorityAttendConfig {
  /** Weight for stimulus salience factor. Default: 0.3. */
  stimulusWeight?: number;
  /** Weight for goal relevance factor. Default: 0.4. */
  goalWeight?: number;
  /** Weight for selection history factor. Default: 0.3. */
  historyWeight?: number;
  /** Suppression factor applied to losing entries after selection. Default: 0.2. */
  suppressionFactor?: number;
  /** Maximum selection history entries to retain. Default: 100. */
  maxHistoryEntries?: number;
}

// ── EVC (Expected Value of Control) Types ───────────────────────

/**
 * Configuration for EVC-based threshold policy.
 *
 * Follows Shenhav, Botvinick & Cohen (2013) — Expected Value of Control.
 * intervene when E[payoff] - E[cost] > 0.
 */
export interface EVCConfig {
  /** Weight for prediction error in payoff estimation. Default: 1.0. */
  payoffWeight?: number;
  /** Weight for remaining budget in cost estimation. Default: 1.0. */
  costWeight?: number;
  /** Minimum prediction error to consider intervention. Default: 0.1. */
  minPredictionError?: number;
  /** Bias term — positive values favor intervention, negative values favor skipping. Default: 0.0. */
  bias?: number;
}
