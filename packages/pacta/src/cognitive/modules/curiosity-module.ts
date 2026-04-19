// SPDX-License-Identifier: Apache-2.0
/**
 * Curiosity Module — learning progress tracking and explore/exploit decisions (PRD 037).
 *
 * Computes curiosity signals from prediction error histories, tracks learning
 * progress per domain, and decides whether to explore (try new approaches)
 * or exploit (continue the current one). All computations are deterministic
 * and rule-based (zero LLM calls).
 *
 * Grounded in: Oudeyer, Kaplan & Hafner (2007) — intrinsic motivation via
 * learning progress; Schmidhuber (2010) — formal theory of curiosity.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Curiosity module. */
export interface CuriosityConfig {
  /** Number of recent errors to track per domain. Default: 10. */
  windowSize: number;
  /** Minimum progress to consider meaningful (below this = stagnating). Default: 0.05. */
  noiseFloor: number;
  /** Max exploration steps before forced exploit. Default: 5. */
  explorationBudgetMax: number;
  /** Whether the module is active. Default: true. */
  enabled: boolean;
}

/** Per-cycle state maintained by the Curiosity module. */
export interface CuriosityState {
  /** domain -> recent prediction errors (sliding window). */
  predictionErrors: Map<string, number[]>;
  /** domain -> current learning progress value. */
  learningProgress: Map<string, number>;
  /** Remaining exploration steps before forced exploit. */
  explorationBudget: number;
  /** Current decision mode. */
  currentMode: 'exploit' | 'explore';
  /** Total number of exploration steps taken over lifetime. */
  totalExplorations: number;
}

/** Output produced each cycle by the Curiosity module. */
export interface CuriosityOutput {
  /** 0-1 curiosity intensity (absolute learning progress, clamped). */
  signal: number;
  /** The domain with the highest absolute learning progress. */
  domain: string;
  /** Current explore/exploit decision. */
  mode: 'exploit' | 'explore';
  /** Suggested sub-goal when exploring. Undefined when exploiting. */
  explorationGoal?: string;
}

/** Input accepted by the Curiosity module each cycle. */
export interface CuriosityInput {
  /** Prediction errors from the latest cycle, keyed by domain. */
  predictionErrors: Map<string, number>;
}

/** Monitoring signal emitted by the Curiosity module. */
export interface CuriosityMonitoring extends MonitoringSignal {
  type: 'curiosity';
  signal: number;
  mode: 'exploit' | 'explore';
  domain: string;
  explorationBudget: number;
}

// ── Default Config ────────────────────────────────────────────────

/** Return default curiosity configuration. */
export function defaultCuriosityConfig(): CuriosityConfig {
  return {
    windowSize: 10,
    noiseFloor: 0.05,
    explorationBudgetMax: 5,
    enabled: true,
  };
}

// ── Pure Computation ──────────────────────────────────────────────

/**
 * Compute learning progress for a single domain's error window.
 *
 * Learning progress = mean(recent half) - mean(older half).
 * Positive LP -> errors are increasing -> the agent is encountering
 * new territory and learning from it.
 * Negative LP -> errors are decreasing -> the agent is converging.
 * Near-zero LP -> stagnation.
 *
 * Following Oudeyer (2007): LP is the derivative of prediction error,
 * not of competence. A *rise* in error signals new complexity to learn,
 * which is what drives curiosity (intrinsic motivation).
 */
export function computeLearningProgress(errors: number[]): number {
  if (errors.length < 2) return 0;

  const mid = Math.floor(errors.length / 2);
  const older = errors.slice(0, mid);
  const recent = errors.slice(mid);

  const olderMean = mean(older);
  const recentMean = mean(recent);

  return recentMean - olderMean;
}

/**
 * Decide explore vs exploit based on learning progress and budget.
 *
 * Explore when: |LP| < noiseFloor (stagnating — try something different)
 *   AND explorationBudget > 0.
 * Exploit when: |LP| >= noiseFloor (meaningful progress — keep going)
 *   OR explorationBudget === 0 (budget exhausted — forced exploit).
 */
export function decideMode(
  learningProgress: number,
  noiseFloor: number,
  explorationBudget: number,
): 'exploit' | 'explore' {
  if (explorationBudget <= 0) return 'exploit';
  if (Math.abs(learningProgress) < noiseFloor) return 'explore';
  return 'exploit';
}

/**
 * Generate a simple exploration sub-goal suggestion based on the domain
 * and current state.
 */
export function generateExplorationGoal(domain: string, lp: number): string {
  if (lp <= -0.01) {
    return `Re-examine assumptions in domain '${domain}' — prediction accuracy is declining.`;
  }
  if (Math.abs(lp) < 0.01) {
    return `Try a different approach in domain '${domain}' — learning has stalled.`;
  }
  return `Explore edge cases in domain '${domain}' — incremental progress detected.`;
}

/**
 * Compute curiosity signal intensity from learning progress values.
 *
 * Signal = max absolute LP across all domains, clamped to [0, 1].
 * Higher signal = more "interesting" things happening.
 */
export function computeCuriositySignal(
  learningProgressMap: Map<string, number>,
): number {
  if (learningProgressMap.size === 0) return 0;

  let maxAbsLP = 0;
  for (const [, lp] of learningProgressMap) {
    const abs = Math.abs(lp);
    if (abs > maxAbsLP) maxAbsLP = abs;
  }

  return Math.min(1, maxAbsLP);
}

/**
 * Find the domain with the highest absolute learning progress.
 * Returns 'unknown' if no domains are tracked.
 */
export function findMostCuriousDomain(
  learningProgressMap: Map<string, number>,
): string {
  if (learningProgressMap.size === 0) return 'unknown';

  let bestDomain = 'unknown';
  let bestAbs = -1;
  for (const [domain, lp] of learningProgressMap) {
    const abs = Math.abs(lp);
    if (abs > bestAbs) {
      bestAbs = abs;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

// ── Helpers ───────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// ── Factory ───────────────────────────────────────────────────────

/**
 * Create a Curiosity cognitive module.
 *
 * The Curiosity module tracks prediction errors per domain, computes
 * learning progress (Oudeyer 2007), and decides explore vs exploit.
 * All computation is deterministic and rule-based (zero LLM calls).
 */
export function createCuriosityModule(
  config?: Partial<CuriosityConfig>,
): CognitiveModule<CuriosityInput, CuriosityOutput, CuriosityState, CuriosityMonitoring, ControlDirective> {
  const resolved: CuriosityConfig = {
    ...defaultCuriosityConfig(),
    ...config,
  };

  const id = moduleId('curiosity');

  return {
    id,

    async step(
      input: CuriosityInput,
      state: CuriosityState,
      _control: ControlDirective,
    ): Promise<StepResult<CuriosityOutput, CuriosityState, CuriosityMonitoring>> {
      // If disabled, pass through with neutral output
      if (!resolved.enabled) {
        const output: CuriosityOutput = {
          signal: 0,
          domain: 'unknown',
          mode: 'exploit',
        };
        const monitoring: CuriosityMonitoring = {
          type: 'curiosity',
          source: id,
          timestamp: Date.now(),
          signal: 0,
          mode: 'exploit',
          domain: 'unknown',
          explorationBudget: state.explorationBudget,
        };
        return { output, state, monitoring };
      }

      // ── Phase 1: Incorporate new prediction errors ──

      const newPredictionErrors = new Map<string, number[]>(
        Array.from(state.predictionErrors.entries()).map(
          ([k, v]) => [k, [...v]],
        ),
      );

      for (const [domain, error] of input.predictionErrors) {
        const existing = newPredictionErrors.get(domain) ?? [];
        existing.push(error);
        // Enforce sliding window
        while (existing.length > resolved.windowSize) {
          existing.shift();
        }
        newPredictionErrors.set(domain, existing);
      }

      // ── Phase 2: Compute learning progress per domain ──

      const newLearningProgress = new Map<string, number>();
      for (const [domain, errors] of newPredictionErrors) {
        const lp = computeLearningProgress(errors);
        newLearningProgress.set(domain, lp);
      }

      // ── Phase 3: Derive curiosity signal and top domain ──

      const signal = computeCuriositySignal(newLearningProgress);
      const topDomain = findMostCuriousDomain(newLearningProgress);
      const topLP = newLearningProgress.get(topDomain) ?? 0;

      // ── Phase 4: Explore/exploit decision ──

      // Require at least 2 data points in some domain before considering explore.
      // Without sufficient data, LP=0 is uninformative (cold start), not stagnation.
      const hasEnoughData = Array.from(newPredictionErrors.values()).some(
        errors => errors.length >= 2,
      );

      const mode = hasEnoughData
        ? decideMode(topLP, resolved.noiseFloor, state.explorationBudget)
        : 'exploit';

      // ── Phase 5: Update budget and generate goal ──

      let newBudget = state.explorationBudget;
      let newTotalExplorations = state.totalExplorations;
      let explorationGoal: string | undefined;

      if (mode === 'explore') {
        newBudget = state.explorationBudget - 1;
        newTotalExplorations += 1;
        explorationGoal = generateExplorationGoal(topDomain, topLP);
      }

      // ── Phase 6: Assemble new state ──

      const newState: CuriosityState = {
        predictionErrors: newPredictionErrors,
        learningProgress: newLearningProgress,
        explorationBudget: newBudget,
        currentMode: mode,
        totalExplorations: newTotalExplorations,
      };

      const output: CuriosityOutput = {
        signal,
        domain: topDomain,
        mode,
        explorationGoal,
      };

      const monitoring: CuriosityMonitoring = {
        type: 'curiosity',
        source: id,
        timestamp: Date.now(),
        signal,
        mode,
        domain: topDomain,
        explorationBudget: newBudget,
      };

      return { output, state: newState, monitoring };
    },

    initialState(): CuriosityState {
      return {
        predictionErrors: new Map(),
        learningProgress: new Map(),
        explorationBudget: resolved.explorationBudgetMax,
        currentMode: 'exploit',
        totalExplorations: 0,
      };
    },

    stateInvariant(state: CuriosityState): boolean {
      return (
        state.explorationBudget >= 0 &&
        state.explorationBudget <= resolved.explorationBudgetMax &&
        state.totalExplorations >= 0 &&
        (state.currentMode === 'exploit' || state.currentMode === 'explore') &&
        // All error windows respect size limit
        Array.from(state.predictionErrors.values()).every(
          errors => errors.length <= resolved.windowSize,
        )
      );
    },
  };
}
